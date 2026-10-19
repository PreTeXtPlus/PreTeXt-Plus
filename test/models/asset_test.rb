require "test_helper"

class AssetTest < ActiveSupport::TestCase
  test "url returns the attached file's url, named after the asset's ref rather than the upload" do
    asset = assets(:image_one)

    ActiveStorage::Current.url_options = { host: "example.com" }
    travel_to Time.current do
      assert_equal asset.file.url(expires_in: 1.hour, filename: asset.external_filename), asset.url
    end
  end

  test "url is the placeholder image when no file is attached" do
    asset = assets(:authored_one)

    assert_equal "/image-not-found.svg", asset.url
  end

  test "file_content_type returns the attached file's MIME type" do
    asset = assets(:image_one)

    assert_equal "image/png", asset.file_content_type
  end

  test "file_content_type is nil when no file is attached" do
    assert_nil assets(:authored_one).file_content_type
  end

  test "file_extension is inferred from content_type even when the uploaded filename has none" do
    asset = assets(:image_one)
    # Mirrors a pasted clipboard image: the web-editor renames the file to a
    # bare, extensionless placeholder before it ever reaches the server (see
    # NewAssetForm's namePastedImageFile), so the filename can't be
    # trusted -- only the real content type can.
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "pasted-image-1234567890", content_type: "image/png"
    )

    assert_equal "png", asset.file_extension
  end

  test "file_extension is nil for a content type with no known extension mapping" do
    asset = assets(:image_one)
    asset.file.attach(
      io: StringIO.new("hello world"),
      filename: "test.txt", content_type: "text/plain"
    )

    assert_nil asset.file_extension
  end

  test "external_filename is ref.ext, ignoring the uploaded filename" do
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "pasted-image-1234567890", content_type: "image/png"
    )

    assert_equal "#{asset.ref}.png", asset.external_filename
  end

  test "external_filename falls back to the bare ref when the content type has no known extension" do
    asset = assets(:image_one)
    asset.file.attach(
      io: StringIO.new("hello world"),
      filename: "test.txt", content_type: "text/plain"
    )

    assert_equal asset.ref, asset.external_filename
  end

  test "external_filename is nil when no file is attached" do
    assert_nil assets(:authored_one).external_filename
  end

  test "ref must be unique among divisions in the same project" do
    project = projects(:one)
    Division.create!(project: project, ref: "taken_ref", source_format: :pretext, is_root: false)

    asset = Asset.new(project: project, ref: "taken_ref", kind: :file)

    assert_not asset.valid?
    assert_includes asset.errors[:ref], "has already been taken"
  end

  test "full_dup gives the copy an independent asset row that shares the original's file blob" do
    project = projects(:one)
    asset = assets(:image_one)

    copy = project.full_dup(users(:two))
    copy.save!

    copied_asset = copy.assets.find_by!(ref: asset.ref)
    assert_not_equal asset.id, copied_asset.id
    assert copied_asset.file.attached?
    assert_equal asset.file.blob, copied_asset.file.blob
  end

  test "unsubscribed owner is capped at 100 total assets across all their projects" do
    owner = users(:one)
    project = Project.create!(user: owner, title: "Quota project")
    remaining = owner.asset_quota - owner.assets.count
    remaining.times { |n| project.assets.create!(ref: "cap-#{n}", kind: :authored, title: "A#{n}") }

    assert_equal owner.asset_quota, owner.reload.assets.count

    over = project.assets.build(ref: "cap-over", kind: :authored, title: "Over")
    assert_not over.valid?
    assert_match(/limit/i, over.errors[:base].to_sentence)
  end

  test "subscribed owner is not capped by asset count" do
    owner = users(:subscribed)
    project = Project.create!(user: owner, title: "Quota project")
    101.times { |n| project.assets.create!(ref: "sub-#{n}", kind: :authored, title: "S#{n}") }

    assert_equal 101, project.assets.count
  end

  test "asset quota follows the project owner's plan, not the collaborator's" do
    owner = users(:one) # unsubscribed
    project = Project.create!(user: owner, title: "Quota project")
    remaining = owner.asset_quota - owner.assets.count
    remaining.times { |n| project.assets.create!(ref: "collab-#{n}", kind: :authored, title: "A#{n}") }

    # users(:subscribed) is an unrelated, subscribed account -- their own plan
    # must not lift the cap on someone else's project.
    over = project.assets.build(ref: "collab-over", kind: :authored, title: "Collab Over")
    assert_not over.valid?
  end

  test "asset quota is not enforced on existing rows (grandfathering)" do
    assert assets(:authored_one).valid?
  end

  test "thumbnailable? is false when no file is attached" do
    assert_not assets(:authored_one).thumbnailable?
  end

  test "thumbnailable? is true for a variable raster image content type" do
    asset = assets(:image_one)

    assert asset.thumbnailable?
  end

  test "thumbnailable? is true for svg, which bypasses variant processing" do
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.svg")),
      filename: "test_image.svg", content_type: "image/svg+xml"
    )

    assert asset.thumbnailable?
  end

  # Content type is declared at attach time, but ActiveStorage sniffs the
  # actual bytes (via Marcel) rather than trusting it blindly -- so this has
  # to be real non-image bytes, not real image bytes mislabeled.
  test "thumbnailable? is false for a content type ActiveStorage can't raster a variant of" do
    asset = assets(:image_one)
    asset.file.attach(
      io: StringIO.new("hello world"),
      filename: "test.txt", content_type: "text/plain"
    )

    assert_not asset.thumbnailable?
  end

  test "thumbnail_url is nil when the asset isn't thumbnailable" do
    assert_nil assets(:authored_one).thumbnail_url
  end

  test "thumbnail_url reuses the full url for svg instead of processing a variant" do
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.svg")),
      filename: "test_image.svg", content_type: "image/svg+xml"
    )

    ActiveStorage::Current.url_options = { host: "example.com" }
    travel_to Time.current do
      assert_equal asset.url, asset.thumbnail_url
    end
  end

  test "thumbnail_url returns a resized variant's url for a raster image" do
    asset = assets(:image_one)

    ActiveStorage::Current.url_options = { host: "example.com" }
    url = asset.thumbnail_url

    assert_not_nil url
    assert_not_equal asset.url, url
  end

  # --- Generated assets (docs/generated-assets-plan.md) ---

  def generated_asset(source: '<diagram dimensions="(300,300)"/>', **attrs)
    projects(:one).assets.build({ kind: :generated, generator: "prefigure", ref: "graph", title: "Graph",
                                  source: source }.merge(attrs))
  end

  def attach_svg(asset)
    asset.file.attach(io: File.open(Rails.root.join("test/fixtures/files/test_diagram.svg")),
                      filename: "graph.svg", content_type: "image/svg+xml")
  end

  test "a generated asset needs a known generator, and other kinds must not name one" do
    assert generated_asset.valid?
    assert_not generated_asset(generator: nil).valid?
    assert_not generated_asset(generator: "tikz").valid?

    authored = assets(:authored_one)
    authored.generator = "prefigure"
    assert_not authored.valid?
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

  test "docinfo_element_inner reads the raw inner text, tolerating attributes, and is empty when absent" do
    assert_equal " a &amp; b ", Asset.docinfo_element_inner('<docinfo><macros xml:space="preserve"> a &amp; b </macros></docinfo>', "macros")
    assert_equal "", Asset.docinfo_element_inner("<docinfo/>", "prefigure-preamble")
  end

  test "output_current? holds only while the digest matches the source and docinfo" do
    asset = generated_asset
    attach_svg(asset)
    asset.output_source_digest = Digest::SHA256.hexdigest(asset.render_input)
    assert asset.output_current?

    asset.source = "<diagram/>"
    assert_not asset.output_current?, "editing the source must invalidate the output"

    asset.source = '<diagram dimensions="(300,300)"/>'
    assert asset.output_current?
    asset.project.docinfo = "<docinfo><macros>\\newcommand{\\N}{x}</macros></docinfo>"
    assert_not asset.output_current?, "macros are an input to the render"
  end

  test "output_current? is false with no output or no digest" do
    assert_not generated_asset.output_current?
    asset = generated_asset
    attach_svg(asset)
    assert_not asset.output_current?
  end

  test "generated_files names every output as a build would, from the ref and each rendition's suffix" do
    asset = generated_asset
    attach_svg(asset)
    asset.renditions.attach(io: StringIO.new("<diagram/>"), filename: "-annotations.xml", content_type: "application/xml")
    asset.renditions.attach(io: File.open(Rails.root.join("test/fixtures/files/test_diagram.svg")),
                            filename: "-diagcess.svg", content_type: "image/svg+xml")
    assert asset.save, asset.errors.full_messages.inspect

    assert_equal %w[ graph.svg graph-annotations.xml graph-diagcess.svg ], asset.generated_files.keys
    assert_equal asset.file.blob, asset.generated_files["graph.svg"]

    asset.update!(ref: "plot")
    assert_equal %w[ plot.svg plot-annotations.xml plot-diagcess.svg ], asset.reload.generated_files.keys
  end

  test "generated_files is empty for a file asset and for a generated asset with no output" do
    assert_empty assets(:image_one).generated_files
    assert_empty generated_asset.generated_files
  end

  test "a generated asset's primary output must be an SVG and its renditions must be suffix-named outputs" do
    asset = generated_asset
    asset.file.attach(io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
                      filename: "graph.png", content_type: "image/png")
    assert_not asset.valid?
    assert_match(/SVG/, asset.errors.full_messages.join)

    asset = generated_asset
    attach_svg(asset)
    asset.renditions.attach(io: StringIO.new("x"), filename: "graph-annotations.xml", content_type: "application/xml")
    assert_not asset.valid?
    assert_match(/suffix/, asset.errors.full_messages.join)
  end
end
