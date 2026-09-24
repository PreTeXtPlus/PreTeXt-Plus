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

  # The one field the editor's JSON sends that is not simply a column. A latex or
  # markdown root has no PreTeXt tag for the assembler to read a root element
  # from, so this value is the root element, and sending `document_type` instead
  # would report such a document as whatever kind it was created as.
  test "the payload sends the structural document type, not the document_type column" do
    @project.update!(root_element: "book")

    assert_equal "article", @project.document_type
    assert_equal "book", SourceAssembler.new(@project).payload[:document_type]
  end

  test "an asset with no file attached carries no extension, content type or path" do
    asset = assets(:authored_one)
    payload = SourceAssembler.new(asset.project).payload
    entry = payload[:assets].find { |a| a[:id] == asset.id }

    assert_not_nil entry
    assert_equal "authored", entry[:kind]
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
    @project.divisions.destroy_all

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
