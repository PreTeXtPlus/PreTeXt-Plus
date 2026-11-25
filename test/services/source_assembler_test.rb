require "test_helper"

# An integration test rather than a service test because half of what is being
# checked is that `payload` still matches the project JSON the editor is served:
# the assembler reads one shape, two places build it, and the only way they stay
# in step is for something to compare them against the real rendered response.
class SourceAssemblerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:template) # a root with a <plus:section ref/> and a child to resolve
    sign_in users(:two)
  end

  # ---- the payload ---------------------------------------------------------

  test "the payload carries what the editor's own JSON carries" do
    get project_url(@project, format: :json)
    assert_response :success
    json = response.parsed_body

    assert_payload_agrees_with SourceAssembler.new(@project).payload, json
  end

  # The one field the editor's JSON sends that is not simply a column: the type a
  # root with none of its own would be given. It is the root's own type, so that
  # sending `document_type` instead cannot report a document as whatever kind it
  # was created as.
  test "the payload sends the structural document type, not the document_type column" do
    @project.root_division.update!(division_type: "book")

    assert_equal "article", @project.document_type
    assert_equal "book", SourceAssembler.new(@project).payload[:document_type]
  end

  test "an asset with no file attached carries no extension, content type or path" do
    asset = contents(:authored_one)
    payload = SourceAssembler.new(asset.project).payload
    entry = payload[:assets].find { |a| a[:id] == asset.id }

    assert_not_nil entry
    assert_equal "authored_asset", entry[:kind]
    # The web-editor reads these being absent as "this asset has no file", and
    # writes no @source on the <image> it generates. An extension invented here
    # would name a file the archive never wrote.
    assert_not entry.key?(:extension)
    assert_not entry.key?(:content_type)
    assert_not entry.key?(:path)
  end

  # ---- the assembled document ---------------------------------------------

  test "it assembles a document with every placeholder resolved" do
    skip_without_bundle

    source = SourceAssembler.new(@project).call

    assert_match(/\A<pretext/, source)
    assert_includes source, "<title>Template</title>"
    # <plus:section ref="subdivision"/> resolved into the child division itself.
    assert_includes source, "<title>Section</title>"
    assert_includes source, "Starter content"
    assert_not_includes source, "plus:section", "a placeholder survived assembly"
  end

  # A generated asset reaches the document as its source, wrapped by its format's
  # element -- never as an <image source> naming its stored picture, which is only a
  # preview. The format travels as `source_format`, through the same mapping the
  # editor uses.
  test "a generated asset assembles to its generator's element, not its stored picture" do
    skip_without_bundle
    @project.assets.create!(kind: :authored_asset, source_format: "prefigure", ref: "graph", title: "Graph",
                            source: "<diagram dimensions=\"(10,10)\"/>",
                            file: fixture_file_upload("test_diagram.svg", "image/svg+xml"))
    root = @project.root_division
    root.update!(source: "#{root.source}\n<figure><plus:image ref=\"graph\"/></figure>")

    source = SourceAssembler.new(@project).call

    assert_includes source, '<prefigure xmlns="https://prefigure.org" label="graph">'
    assert_includes source, '<diagram dimensions="(10,10)"/>'
    assert_not_includes source, 'source="graph.svg"'
  end

  # An exercise stores its body; the <exercise> element around it is built from
  # its ref, title and attrs, exactly as the editor's preview builds it.
  test "an exercise placeholder assembles to an exercise built from its record" do
    skip_without_bundle
    @project.exercises.create!(ref: "quiz", title: "Quiz", attrs: { "language" => "python" },
      source: "<statement><p>Pick one.</p></statement>")
    child = @project.divisions.find_by!(ref: "subdivision")
    child.update!(source: "#{child.source}\n<plus:exercise ref=\"quiz\"/>")

    source = SourceAssembler.new(@project).call

    assert_includes source, '<exercise xml:id="quiz" label="quiz" language="python">'
    assert_includes source, "<title>Quiz</title>"
    assert_includes source, "Pick one."
    assert_not_includes source, "plus:exercise"
  end

  # ---- Doenet activities -----------------------------------------------------

  # A build is handed a dual exercise -- the activity for HTML, a note for every
  # static output -- under every wrapper, which is what puts it in a Runestone
  # manifest; and a frame that fits its box, with no aspect to fix its height.
  test "a placed Doenet activity is assembled dual, in a responsive frame" do
    skip_without_bundle
    @project.exercises.create!(ref: "act", title: "Try it", source_format: "doenetml",
      attrs: { "width" => "100%", "aspect" => "4:3" }, source: "<p>Is <m>x < 2</m>?</p>")
    child = @project.divisions.find_by!(ref: "subdivision")
    child.update!(source: "#{child.source}\n<plus:exercise ref=\"act\"/>\n<plus:project ref=\"act\" instance=\"p\"/>\n" \
                          "<figure><caption>Bare</caption><plus:interactive ref=\"act\" instance=\"f\"/></figure>")

    document = Nokogiri::XML(SourceAssembler.new(@project).call)

    %w[ exercise project ].each do |tag|
      wrapper = document.at_xpath("//#{tag}[starts-with(@xml:id, 'act')]")
      assert_equal %w[ title dynamic static ], wrapper.element_children.map(&:name), tag
      assert_equal "<p>Is <m>x < 2</m>?</p>", wrapper.at_xpath("dynamic/statement/interactive/slate").text
      assert_match(/available in the online version/, wrapper.at_xpath("static/statement/p").text)
    end
    interactives = document.xpath("//interactive[@platform='doenetml']")
    assert_equal 3, interactives.size
    interactives.each do |interactive|
      assert_equal "responsive", interactive["resize-behavior"]
      assert_nil interactive["aspect"]
    end
  end

  # ---- the multi-file project ---------------------------------------------

  # What an author downloads. The claim that matters is that it is the same
  # document a build is handed, so this runs libxml2's own XInclude over the
  # files on disk -- what `pretext build` does -- and compares the result with
  # the single file, element for element.
  test "the files are the assembled document, joined by xi:include" do
    skip_without_bundle
    @project.exercises.create!(ref: "act", title: "Try it", source_format: "doenetml",
      attrs: { "width" => "100%" }, source: "<p>Is <m>x < 2</m>?</p>\n<answer>yes</answer>")
    child = @project.divisions.find_by!(ref: "subdivision")
    @project.assets.create!(kind: :authored_asset, source_format: "tikz", ref: "plot", title: "Plot",
                            source: "\\node {$a < b$} \\amp c & d;")
    @project.assets.create!(kind: :authored_asset, source_format: "prefigure", ref: "graph", title: "Graph",
                            source: "<diagram dimensions=\"(10,10)\"><grid/></diagram>")
    child.update!(source: "#{child.source}\n<plus:exercise ref=\"act\"/>\n" \
                          "<figure><plus:image ref=\"plot\"/></figure>\n<figure><plus:image ref=\"graph\"/></figure>")

    assembler = SourceAssembler.new(@project)
    files = assembler.files

    assert_equal "main.ptx", files.keys.first
    assert_equal %w[docinfo.ptx doenet/act.doenet main.ptx prefigure/graph.xml subdivision.ptx tikz/plot.tex],
                 files.keys.sort
    assert_includes files["main.ptx"], '<xi:include href="subdivision.ptx"/>'
    assert_not_includes files["main.ptx"], "Starter content"
    assert_includes files["subdivision.ptx"], '<xi:include href="doenet/act.doenet" parse="text"/>'
    # DoenetML as typed: no CDATA wrapper, no entity escapes.
    assert_equal "<p>Is <m>x < 2</m>?</p>\n<answer>yes</answer>", files["doenet/act.doenet"]

    # TeX as typed, and a PreFigure diagram that is a document in its own namespace.
    assert_equal "\\node {$a < b$} \\amp c & d;", files["tikz/plot.tex"]
    assert_includes files["prefigure/graph.xml"], '<diagram dimensions="(10,10)" xmlns="https://prefigure.org">'

    assert_equal canonical(assembler.call), canonical(xincluded(files))
  end

  test "a file path that could leave the source directory is refused" do
    listing = JSON.generate(files: [ { path: "../project.ptx", content: "" } ])

    NodeScript.stub(:new, ->(*, **) { Struct.new(:noop) { define_method(:call) { |*, **| listing } }.new }) do
      error = assert_raises(SourceAssembler::AssemblyError) { SourceAssembler.new(@project).files }
      assert_match "unsafe file path", error.message
    end
  end

  # TikZ is TeX: the buffer is not XML, so the document's copy of it is escaped.
  test "a TikZ asset assembles to a latex-image with its source as XML text" do
    skip_without_bundle
    @project.assets.create!(kind: :authored_asset, source_format: "tikz", ref: "plot", title: "Plot",
                            source: "\\node {$a < b$} \\amp c & d;")
    root = @project.root_division
    root.update!(source: "#{root.source}\n<figure><plus:image ref=\"plot\"/></figure>")

    source = SourceAssembler.new(@project).call

    assert_includes source, %(<latex-image label="plot">\n\\node {$a &lt; b$} \\amp c &amp; d;\n</latex-image>)
  end

  # PreTeXt reads the external directory from the docinfo (2026-07-30), so every
  # document bound for an archive names where the archive puts uploads -- beside
  # whatever else the author's docinfo holds, and whichever docinfo is in effect.
  test "the docinfo declares the archive's external directory" do
    skip_without_bundle
    @project.update!(docinfo: "<docinfo><macros>\\def\\projectown{1}</macros></docinfo>")
    assembler = SourceAssembler.new(@project)

    assert_includes assembler.call, '<directories external="../assets"/>'
    assert_includes assembler.call, "\\def\\projectown{1}"
    assert_includes assembler.files["docinfo.ptx"], '<directories external="../assets"/>'

    @project.user.update!(common_docinfo: "<docinfo><directories data=\"data\" external=\"elsewhere\"/></docinfo>")
    @project.update!(use_common_docinfo: true)

    assert_includes SourceAssembler.new(@project).call, '<directories data="data" external="../assets"/>'
  end

  test "the docinfo in effect is the one that lands in the document" do
    skip_without_bundle
    @project.update!(docinfo: "<docinfo><macros>\\def\\projectown{1}</macros></docinfo>")

    assert_includes SourceAssembler.new(@project).call, "\\projectown"

    @project.user.update!(common_docinfo: "<docinfo><macros>\\def\\shared{1}</macros></docinfo>")
    @project.update!(use_common_docinfo: true)

    source = SourceAssembler.new(@project.reload).call
    assert_includes source, "\\shared"
    assert_not_includes source, "\\projectown"
  end

  test "the document's language is written as xml:lang" do
    skip_without_bundle
    @project.update!(language: "fr-FR")

    assert_includes SourceAssembler.new(@project).call, 'xml:lang="fr-FR"'
  end

  # "" rather than a raise: it is what the editor's own save path produced for a
  # project in this state, and what the column it replaced held. A build of one
  # is a separate question, answered by the build server rejecting it.
  test "a project with no root division assembles to nothing" do
    skip_without_bundle
    # Unreachable through the models now, which keep exactly one root, but rows
    # from before that rule may still be rootless.
    @project.divisions.delete_all(:delete_all)

    assert_equal "", SourceAssembler.new(@project.reload).call
  end

  # ---- failure -------------------------------------------------------------

  test "a missing bundle is an AssemblyError naming how to build it" do
    missing = Rails.root.join("tmp", "no-such-assembler.mjs")
    stub_const(SourceAssembler, :BUNDLE, missing) do
      error = assert_raises(SourceAssembler::AssemblyError) { SourceAssembler.new(@project).call }
      assert_match "npm run build:assembler", error.message
    end
  end

  test "an assembler that exits non-zero is an AssemblyError carrying its stderr" do
    skip_without_bundle
    script = Rails.root.join("tmp", "failing-assembler-#{SecureRandom.hex(4)}.mjs")
    script.write("process.stderr.write('deliberate\\n'); process.exit(1);\n")

    begin
      stub_const(SourceAssembler, :BUNDLE, script) do
        error = assert_raises(SourceAssembler::AssemblyError) { SourceAssembler.new(@project).call }
        assert_match "exited 1", error.message
        assert_match "deliberate", error.message
      end
    ensure
      script.delete
    end
  end

  test "an assembler that never finishes is killed rather than held onto" do
    skip_without_bundle
    script = Rails.root.join("tmp", "hanging-assembler-#{SecureRandom.hex(4)}.mjs")
    script.write("setInterval(() => {}, 1000);\n")

    begin
      stub_const(SourceAssembler, :BUNDLE, script) do
        stub_const(SourceAssembler, :TIMEOUT, 1) do
          error = assert_raises(SourceAssembler::AssemblyError) { SourceAssembler.new(@project).call }
          assert_match "timed out", error.message
        end
      end
    ensure
      script.delete
    end
  end

  private

    # The bundle is a build product (`npm run build:assembler`, which
    # assets:precompile runs), so a checkout that has not built it yet still gets
    # a green Ruby suite rather than a wall of failures about a missing file.
    # `files` written to disk and read back through libxml2 with XInclude on.
    def xincluded(files)
      Dir.mktmpdir do |dir|
        files.each do |path, content|
          FileUtils.mkdir_p(File.dirname(File.join(dir, path)))
          File.write(File.join(dir, path), content)
        end
        main = File.join(dir, "main.ptx")
        Nokogiri::XML(File.read(main), main) { |config| config.strict.xinclude }.to_xml
      end
    end

    # A document reduced to what PreTeXt reads: no xml:base (libxml2 records where
    # an included element came from), no xi namespace declaration, CDATA as text.
    def canonical(xml)
      doc = Nokogiri::XML(xml) { |config| config.strict.nocdata }
      doc.xpath("//@xml:base").each(&:remove)
      doc.canonicalize.gsub(%( xmlns:xi="http://www.w3.org/2001/XInclude"), "")
    end

    def skip_without_bundle
      return if SourceAssembler::BUNDLE.exist?

      skip "assembler bundle not built -- run `npm run build:assembler`"
    end

    # Every value in `payload` must be the value the rendered JSON has under the
    # same key. Not equality in the other direction: the JSON carries fields
    # assembly has no use for (urls, collaboration, dictionary words), and adding
    # one of those should not fail this.
    def assert_payload_agrees_with(payload, json, path = "project")
      payload.each do |key, expected|
        here = "#{path}.#{key}"
        assert json.key?(key.to_s), "#{here} is in the assembler payload but not in the rendered JSON"
        actual = json[key.to_s]

        case expected
        when Array
          assert_equal expected.size, actual.size, "#{here} has a different number of records"
          expected.zip(actual).each_with_index do |(e, a), i|
            assert_payload_agrees_with(e, a, "#{here}[#{i}]")
          end
        when nil
          assert_nil actual, "#{here} disagrees with the rendered JSON"
        else
          assert_equal expected, actual, "#{here} disagrees with the rendered JSON"
        end
      end
    end
end
