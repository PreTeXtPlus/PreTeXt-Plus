require "test_helper"

class ContentTest < ActiveSupport::TestCase
  # ---- refs: one namespace across every kind --------------------------------

  test "a ref is unique across every kind of content in a project" do
    project = projects(:one)
    project.snippets.create!(ref: "taken_ref")

    [ project.divisions.build(ref: "taken_ref"),
      project.snippets.build(ref: "taken_ref"),
      project.assets.build(ref: "taken_ref", kind: :file_asset) ].each do |content|
      assert_not content.valid?, "a #{content.kind} took a ref a snippet holds"
      assert_includes content.errors[:ref], "has already been taken"
    end
  end

  test "the same ref may be used in another project" do
    assert projects(:two).snippets.build(ref: contents(:image_one).ref).valid?
  end

  test "is valid with a unique ref" do
    assert projects(:one).snippets.build(ref: "unique_ref", source: "hello").valid?
  end

  # A ref is an xml:id and a label, and the last part of a generated image's
  # filename: letters, digits, "-" and "_", not starting with a digit or "-".
  # The `A-z` range this once had also let `[`, `\`, `]`, `^` and a backtick
  # lead.
  test "a ref starts with a letter or underscore and holds only letters, digits, - and _" do
    %w[ graph _graph Graph-2 a_b-c ].each do |ref|
      assert projects(:one).snippets.build(ref: ref).valid?, "#{ref} should be a valid ref"
    end
    [ "2graph", "-graph", "[graph", "\\graph", "]graph", "^graph", "`graph", "gr.aph", "gr aph" ].each do |ref|
      assert_not projects(:one).snippets.build(ref: ref).valid?, "#{ref} should not be a valid ref"
    end
  end

  # ---- kinds ---------------------------------------------------------------

  test "a record built through a kind's collection is of that kind" do
    project = projects(:one)

    assert project.divisions.build(ref: "d").division?
    assert project.snippets.build(ref: "s").snippet?
  end

  test "the per-kind collections hold only their own kind" do
    project = projects(:one)

    assert_equal [ "division" ], project.divisions.map(&:kind).uniq
    assert_equal %w[ authored_asset file_asset ], project.assets.map(&:kind).uniq.sort
    assert project.contents.count > project.divisions.count
  end

  # The external @pretextbook/import package still writes an asset's kind the
  # way the column used to spell it.
  test "an asset's legacy file/authored kind is read as the kind it now is" do
    assert_equal "file_asset", Content.new(kind: "file").kind
    assert_equal "authored_asset", Content.new(kind: "authored").kind
  end

  test "only a division may be the root" do
    snippet = projects(:one).snippets.build(ref: "s", is_root: true)

    assert_not snippet.valid?
    assert_includes snippet.errors[:is_root], "is only for divisions"
  end

  # ---- divisions -----------------------------------------------------------

  # Assembly writes `division_type` as the element's tag, so the two lists have
  # to name the same elements.
  test "division types match the web-editor's DivisionType" do
    source = Rails.root.join("packages/web-editor/src/types/sections.ts").read
    union = source[/export type RootDivisionType =(.*?);/m, 1] + source[/export type DivisionType =(.*?);/m, 1]

    assert_equal union.scan(/"([a-z-]+)"/).flatten.sort, Content::DIVISION_TYPES.sort
  end

  test "a division's type must be a division element" do
    division = projects(:one).divisions.build(ref: "d", division_type: "theorem")

    assert_not division.valid?
    assert division.errors[:division_type].any?
  end

  test "a division with no type is given the one its place implies" do
    project = projects(:one)
    division = project.divisions.build(ref: "d")

    assert division.valid?
    assert_equal "section", division.division_type
  end

  test "a root's type must be a document root element" do
    root = contents(:one)

    assert_not root.update(division_type: "chapter")
    assert_includes root.errors[:division_type], "must be a document root element"
  end

  # The starter matters more here than for a document: an empty <slideshow> builds to a
  # blank deck rather than an error, so a missing starter would look like a broken build.
  test "a slideshow's root division starts from the deck starter for its markup style" do
    { pretext: "<slide>", latex: "\\begin{frame}", markdown: "## First slide" }
      .each do |format, marker|
        project = Project.create!(user: users(:one), title: "Deck", document_type: :slideshow,
                                  divisions_attributes: [ { is_root: true, ref: "document",
                                                            source_format: format } ])
        root = project.root_division

        assert_equal "slideshow", root.division_type
        assert_includes root.source, marker, "expected the #{format} deck starter"
        assert_match(/slideshow/, root.title)
      end
  end

  test "a document's root division starts with its markup style's starter and title" do
    project = Project.create!(user: users(:one), title: "Doc",
                              divisions_attributes: [ { is_root: true, ref: "document",
                                                        source_format: :pretext } ])
    root = project.root_division

    assert_equal "article", root.division_type
    assert_equal "New PreTeXt XML document", root.title
    assert_includes root.source, "This is a new PreTeXt XML document"
    assert_not_includes root.source, "<article", "the element is built from the columns, never stored"
  end

  # Only a new document gets a starter; a new division's body is the editor's to fill.
  test "a non-root division does not get a starter" do
    project = Project.create!(user: users(:one), title: "Deck", document_type: :slideshow,
                              divisions_attributes: [ { is_root: true, ref: "document",
                                                        source_format: :pretext } ])

    child = project.divisions.create!(ref: "part_two", source_format: :pretext)

    assert_equal "", child.source.to_s
    assert_equal "section", child.division_type
  end

  # ---- exactly one root per project ----------------------------------------

  test "a root division cannot be destroyed on its own" do
    root = contents(:one)

    assert_not root.destroy
    assert_includes root.errors[:base], "The root division cannot be deleted"
    assert Content.exists?(root.id)
    assert_raises(ActiveRecord::RecordNotDestroyed) { root.destroy! }
  end

  test "a non-root division can still be destroyed" do
    child = projects(:one).divisions.create!(ref: "child", source: "<p/>")

    assert child.destroy
    assert_not Content.exists?(child.id)
  end

  test "destroying the project takes all of its content with it" do
    project = projects(:one)
    ids = project.contents.pluck(:id)

    project.destroy!

    assert_not Content.exists?(id: ids)
  end

  test "a root division cannot step down" do
    root = contents(:one)

    assert_not root.update(is_root: false)
    assert_includes root.errors[:is_root], "cannot be changed"
    assert root.reload.is_root?
  end

  test "a non-root division cannot be promoted" do
    child = projects(:one).divisions.create!(ref: "child", source: "<p/>")

    assert_not child.update(is_root: true)
    assert_not child.reload.is_root?
  end

  test "a division cannot move to another project" do
    root = contents(:one)

    assert_not root.update(project: projects(:two))
    assert_includes root.errors[:project], "cannot be changed"
    assert_equal projects(:one), root.reload.project
  end

  test "a second root cannot be created" do
    second = projects(:one).divisions.build(ref: "another", is_root: true)

    assert_not second.valid?
    assert_raises(ActiveRecord::RecordNotUnique) { second.save!(validate: false) }
  end

  # ---- assets --------------------------------------------------------------

  test "a file asset holds one file" do
    asset = contents(:image_one)
    asset.files.attach(io: StringIO.new("second"), filename: "b.txt", content_type: "text/plain")

    assert_not asset.valid?
    assert_includes asset.errors[:files], "can hold only one file"
  end

  test "attaching a file replaces the one a file asset had" do
    asset = contents(:image_one)
    asset.attach_file(io: StringIO.new("new"), filename: "new.txt", content_type: "text/plain")
    asset.save!

    assert_equal 1, asset.reload.files.attachments.size
    assert_equal "text/plain", asset.file_content_type
  end

  test "only a file asset may carry a file" do
    snippet = projects(:one).snippets.build(ref: "s")
    snippet.attach_file(io: StringIO.new("x"), filename: "x.txt", content_type: "text/plain")

    assert_not snippet.valid?
    assert_includes snippet.errors[:files], "can be attached only to a file or generated asset"
  end

  test "url returns the attached file's url, named after the asset's ref rather than the upload" do
    asset = contents(:image_one)

    ActiveStorage::Current.url_options = { host: "example.com" }
    travel_to Time.current do
      assert_equal asset.file.url(expires_in: 1.hour, filename: asset.external_filename), asset.url
    end
  end

  test "url is the placeholder image when no file is attached" do
    asset = contents(:authored_one)

    assert_equal "/image-not-found.svg", asset.url
  end

  test "file_content_type returns the attached file's MIME type" do
    asset = contents(:image_one)

    assert_equal "image/png", asset.file_content_type
  end

  test "file_content_type is nil when no file is attached" do
    assert_nil contents(:authored_one).file_content_type
  end

  test "file_extension is inferred from content_type even when the uploaded filename has none" do
    asset = contents(:image_one)
    # Mirrors a pasted clipboard image: the web-editor renames the file to a
    # bare, extensionless placeholder before it ever reaches the server (see
    # NewAssetForm's namePastedImageFile), so the filename can't be
    # trusted -- only the real content type can.
    asset.attach_file(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "pasted-image-1234567890", content_type: "image/png"
    )

    assert_equal "png", asset.file_extension
  end

  test "file_extension is nil for a content type with no known extension mapping" do
    asset = contents(:image_one)
    asset.attach_file(
      io: StringIO.new("hello world"),
      filename: "test.txt", content_type: "text/plain"
    )

    assert_nil asset.file_extension
  end

  test "external_filename is ref.ext, ignoring the uploaded filename" do
    asset = contents(:image_one)
    asset.attach_file(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "pasted-image-1234567890", content_type: "image/png"
    )

    assert_equal "#{asset.ref}.png", asset.external_filename
  end

  test "external_filename falls back to the bare ref when the content type has no known extension" do
    asset = contents(:image_one)
    asset.attach_file(
      io: StringIO.new("hello world"),
      filename: "test.txt", content_type: "text/plain"
    )

    assert_equal asset.ref, asset.external_filename
  end

  test "external_filename is nil when no file is attached" do
    assert_nil contents(:authored_one).external_filename
  end

  test "full_dup gives the copy an independent asset row that shares the original's file blob" do
    project = projects(:one)
    asset = contents(:image_one)

    copy = project.full_dup(users(:two))
    copy.save!

    copied_asset = copy.assets.find_by!(ref: asset.ref)
    assert_not_equal asset.id, copied_asset.id
    assert copied_asset.file_attached?
    assert_equal asset.file.blob, copied_asset.file.blob
  end

  test "unsubscribed owner is capped at 100 total assets across all their projects" do
    owner = users(:one)
    project = Project.create!(user: owner, title: "Quota project")
    remaining = owner.asset_quota - owner.assets.count
    remaining.times { |n| project.assets.create!(ref: "cap-#{n}", kind: :authored_asset, title: "A#{n}") }

    assert_equal owner.asset_quota, owner.reload.assets.count

    over = project.assets.build(ref: "cap-over", kind: :authored_asset, title: "Over")
    assert_not over.valid?
    assert_match(/limit/i, over.errors[:base].to_sentence)
  end

  test "subscribed owner is not capped by asset count" do
    owner = users(:subscribed)
    project = Project.create!(user: owner, title: "Quota project")
    101.times { |n| project.assets.create!(ref: "sub-#{n}", kind: :authored_asset, title: "S#{n}") }

    assert_equal 101, project.assets.count
  end

  test "asset quota follows the project owner's plan, not the collaborator's" do
    owner = users(:one) # unsubscribed
    project = Project.create!(user: owner, title: "Quota project")
    remaining = owner.asset_quota - owner.assets.count
    remaining.times { |n| project.assets.create!(ref: "collab-#{n}", kind: :authored_asset, title: "A#{n}") }

    # users(:subscribed) is an unrelated, subscribed account -- their own plan
    # must not lift the cap on someone else's project.
    over = project.assets.build(ref: "collab-over", kind: :authored_asset, title: "Collab Over")
    assert_not over.valid?
  end

  test "asset quota is not enforced on existing rows (grandfathering)" do
    assert contents(:authored_one).valid?
  end

  test "thumbnailable? is false when no file is attached" do
    assert_not contents(:authored_one).thumbnailable?
  end

  test "thumbnailable? is true for a variable raster image content type" do
    asset = contents(:image_one)

    assert asset.thumbnailable?
  end

  test "thumbnailable? is true for svg, which bypasses variant processing" do
    asset = contents(:image_one)
    asset.attach_file(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.svg")),
      filename: "test_image.svg", content_type: "image/svg+xml"
    )

    assert asset.thumbnailable?
  end

  # Content type is declared at attach time, but ActiveStorage sniffs the
  # actual bytes (via Marcel) rather than trusting it blindly -- so this has
  # to be real non-image bytes, not real image bytes mislabeled.
  test "thumbnailable? is false for a content type ActiveStorage can't raster a variant of" do
    asset = contents(:image_one)
    asset.attach_file(
      io: StringIO.new("hello world"),
      filename: "test.txt", content_type: "text/plain"
    )

    assert_not asset.thumbnailable?
  end

  test "thumbnail_url is nil when the asset isn't thumbnailable" do
    assert_nil contents(:authored_one).thumbnail_url
  end

  test "thumbnail_url reuses the full url for svg instead of processing a variant" do
    asset = contents(:image_one)
    asset.attach_file(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.svg")),
      filename: "test_image.svg", content_type: "image/svg+xml"
    )

    ActiveStorage::Current.url_options = { host: "example.com" }
    travel_to Time.current do
      assert_equal asset.url, asset.thumbnail_url
    end
  end

  test "thumbnail_url returns a resized variant's url for a raster image" do
    asset = contents(:image_one)

    ActiveStorage::Current.url_options = { host: "example.com" }
    url = asset.thumbnail_url

    assert_not_nil url
    assert_not_equal asset.url, url
  end

  # --- Generated assets (docs/generated-assets-plan.md) ---

  def generated_asset(source: '<diagram dimensions="(300,300)"/>', **attrs)
    projects(:one).assets.build({ kind: :authored_asset, source_format: "prefigure", ref: "graph", title: "Graph",
                                  source: source }.merge(attrs))
  end

  def attach_svg(asset)
    asset.file = { io: File.open(Rails.root.join("test/fixtures/files/test_diagram.svg")),
                   filename: "graph.svg", content_type: "image/svg+xml" }
  end

  test "an authored asset in a generator's format is a generated asset, wrapped in that generator's element" do
    asset = generated_asset
    assert asset.valid?, asset.errors.full_messages.inspect
    assert asset.generated_asset?
    assert_equal "prefigure", asset.generated_element

    plain = contents(:authored_one)
    assert plain.pretext_source_format?
    assert_not plain.generated_asset?
    assert_nil plain.generated_element
  end

  test "only an authored asset may take a generator's format, and no asset a prose one" do
    assert_not generated_asset(source_format: "latex").valid?
    assert_not generated_asset(source_format: "markdown").valid?
    assert_not generated_asset(source_format: "asymptote").valid?

    file = contents(:image_one)
    file.source_format = "prefigure"
    assert_not file.valid?

    division = contents(:one)
    division.source_format = "prefigure"
    assert_not division.valid?
  end

  # The same input, byte for byte, is digested by the web-editor (see its generators
  # test): the hex here is the one both sides must agree on.
  test "render_input is the source and the docinfo elements the generator reads, and digests to the shared fixture" do
    asset = generated_asset
    docinfo = "<docinfo>\n  <macros>\\newcommand{\\R}{\\mathbb{R}}</macros>\n</docinfo>"

    assert_equal [ '<diagram dimensions="(300,300)"/>', "\\newcommand{\\R}{\\mathbb{R}}", "" ].join("\n\u0000\n"),
                 asset.render_input(docinfo)
    assert_equal "65ad0eda2b54873333e717242fe79d69243c7ac4f4f1ce5a37fe8641f0d2e9c3",
                 Digest::SHA256.hexdigest(asset.render_input(docinfo))
  end

  test "a TikZ asset is wrapped in latex-image and digests to the fixture the web-editor pins" do
    source = "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}"
    asset = generated_asset(source: source, source_format: "tikz")
    docinfo = <<~XML
      <docinfo>
        <macros>\\newcommand{\\R}{\\mathbb{R}}</macros>
        <latex-image-preamble syntax="PGF">\\usepackage{ignored}</latex-image-preamble>
        <latex-image-preamble>\\usetikzlibrary{calc}</latex-image-preamble>
      </docinfo>
    XML

    assert asset.valid?, asset.errors.full_messages.inspect
    assert_equal "latex-image", asset.generated_element
    assert_equal [ source, "\\newcommand{\\R}{\\mathbb{R}}", "\\usetikzlibrary{calc}" ].join("\n\u0000\n"),
                 asset.render_input(docinfo)
    assert_equal "9cbc7d80acb18afb7b3fb96cdab13750344d897c4fe2d55d98be4e3dfdcfa711",
                 Digest::SHA256.hexdigest(asset.render_input(docinfo))
  end

  test "docinfo_element_inner passes over an element with @syntax, as core does" do
    docinfo = '<latex-image-preamble syntax="PGF">no</latex-image-preamble><latex-image-preamble>yes</latex-image-preamble>'
    assert_equal "yes", Content.docinfo_element_inner(docinfo, "latex-image-preamble")
  end

  test "docinfo_element_inner reads the raw inner text, tolerating attributes, and is empty when absent" do
    assert_equal " a &amp; b ", Content.docinfo_element_inner('<docinfo><macros xml:space="preserve"> a &amp; b </macros></docinfo>', "macros")
    assert_equal "", Content.docinfo_element_inner("<docinfo/>", "prefigure-preamble")
  end

  test "preview_current? holds only while the digest matches the source and docinfo" do
    asset = generated_asset
    attach_svg(asset)
    asset.preview_input_digest = Digest::SHA256.hexdigest(asset.render_input)
    assert asset.preview_current?

    asset.source = "<diagram/>"
    assert_not asset.preview_current?, "editing the source must invalidate the picture"

    asset.source = '<diagram dimensions="(300,300)"/>'
    assert asset.preview_current?
    asset.project.docinfo = "<docinfo><macros>\\newcommand{\\N}{x}</macros></docinfo>"
    assert_not asset.preview_current?, "macros are an input to the render"
  end

  test "preview_current? is false with no picture or no digest" do
    assert_not generated_asset.preview_current?
    asset = generated_asset
    attach_svg(asset)
    assert_not asset.preview_current?
  end

  test "a generated asset's picture must be an SVG, and it serves as the asset's file" do
    asset = generated_asset
    asset.file = { io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
                   filename: "graph.png", content_type: "image/png" }
    assert_not asset.valid?
    assert_match(/SVG/, asset.errors.full_messages.join)

    asset = generated_asset
    attach_svg(asset)
    assert asset.save, asset.errors.full_messages.inspect
    assert_equal "graph.svg", asset.external_filename
    assert asset.thumbnailable?
  end
end
