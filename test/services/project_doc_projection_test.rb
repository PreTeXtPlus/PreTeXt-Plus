require "test_helper"

class ProjectDocProjectionTest < ActiveSupport::TestCase
  ROOT_ID = "33333333-3333-4333-8333-333333333333".freeze
  CHILD_ID = "44444444-4444-4444-8444-444444444444".freeze
  GONE_DIVISION_ID = "55555555-5555-4555-8555-555555555555".freeze
  GONE_ASSET_ID = "66666666-6666-4666-8666-666666666666".freeze

  def fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  setup do
    @project = projects(:one)
  end

  def project!
    ProjectDocProjection.new(@project).apply!
  end

  test "a project with no document is left alone" do
    before = @project.title

    assert_not project!, "there is nothing to project"
    assert_equal before, @project.reload.title
  end

  test "the document's fields become the project's" do
    ProjectDoc.seed(@project, fixture("projection_state"))

    assert project!

    @project.reload
    assert_equal "Projected Title", @project.title
    assert_includes @project.docinfo, "\\newcommand{\\R}"
    assert_equal "fr-FR", @project.language
    assert_equal false, @project.use_common_docinfo
  end

  test "divisions are written with the ids the editor minted, in their own formats" do
    ProjectDoc.seed(@project, fixture("projection_state"))

    project!

    root = Division.find(ROOT_ID)
    assert_equal "projected-root", root.ref
    assert_includes root.source, "<title>Projected Book</title>"
    assert_equal "pretext", root.source_format

    child = Division.find(CHILD_ID)
    assert_equal "projected-ch1", child.ref
    assert_equal "latex", child.source_format
    assert_includes child.source, "\\chapter{One}"
  end

  test "a division the project already has is updated rather than duplicated" do
    @project.divisions.create!(id: ROOT_ID, ref: "stale", source: "<book/>", source_format: "pretext")
    ProjectDoc.seed(@project, fixture("projection_state"))

    assert_difference("@project.divisions.count", 1) do # only the child is new
      project!
    end

    assert_equal "projected-root", Division.find(ROOT_ID).ref
  end

  test "tombstones remove the records they name" do
    @project.divisions.create!(id: GONE_DIVISION_ID, ref: "gone", source: "<section/>", source_format: "pretext")
    @project.assets.create!(id: GONE_ASSET_ID, ref: "gone-asset", kind: :authored)
    ProjectDoc.seed(@project, fixture("projection_state"))

    project!

    assert_not Division.exists?(GONE_DIVISION_ID)
    assert_not Asset.exists?(GONE_ASSET_ID)
  end

  test "a tombstone for something already gone is harmless, and stays harmless" do
    ProjectDoc.seed(@project, fixture("projection_state"))

    # Tombstones are never cleared from the document -- Ruby can read a Y::Doc
    # but not write one -- so every projection re-sends every delete it has ever
    # seen. That has to cost nothing, or the document would rot over a long
    # project's life.
    assert_nothing_raised do
      3.times { project! }
    end
    assert_not Division.exists?(GONE_DIVISION_ID)
  end

  test "projecting twice writes the same thing and does not restale the targets" do
    ProjectDoc.seed(@project, fixture("projection_state"))
    project!
    @project.reload
    settled = @project.source_updated_at

    travel 1.minute do
      project!
    end

    assert_equal settled, @project.reload.source_updated_at,
      "a projection that changes nothing must not make every build target stale"
  end

  test "the root division is never moved by a projection" do
    original_root = @project.divisions.find_by(is_root: true)
    assert_not_nil original_root
    ProjectDoc.seed(@project, fixture("projection_state"))

    project!

    assert_equal original_root.id, @project.reload.divisions.find_by(is_root: true).id
    assert_not Division.find(ROOT_ID).is_root, "a projected division must not claim the root"
  end

  test "a document missing the newer meta fields leaves the project's own values" do
    # seed_state.bin predates useCommonDocinfo/language in the schema fixtures,
    # which is the shape of any document seeded before those fields existed.
    @project.update!(use_common_docinfo: true, language: "de-DE")
    ProjectDoc.seed(@project, fixture("seed_state"))

    project!

    @project.reload
    assert_equal true, @project.use_common_docinfo
    assert_equal "de-DE", @project.language
  end
end
