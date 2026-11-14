require "test_helper"

class ProjectDocProjectionTest < ActiveSupport::TestCase
  ROOT_ID = "33333333-3333-4333-8333-333333333333".freeze
  CHILD_ID = "44444444-4444-4444-8444-444444444444".freeze
  GONE_DIVISION_ID = "55555555-5555-4555-8555-555555555555".freeze
  GONE_ASSET_ID = "66666666-6666-4666-8666-666666666666".freeze
  SNIPPET_ID = "77777777-7777-4777-8777-777777777777".freeze
  ASSET_ID = "88888888-8888-4888-8888-888888888888".freeze
  UNKNOWN_ASSET_ID = "99999999-9999-4999-8999-999999999999".freeze
  GONE_SNIPPET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".freeze
  EXERCISE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".freeze
  DOENET_EXERCISE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd".freeze
  GONE_EXERCISE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc".freeze

  def fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  setup do
    @project = projects(:one)
  end

  def project!
    ProjectDocProjection.new(@project).apply!
  end

  # Make the division the document knows by `id` this project's root, so the
  # projection can find it. A root can no longer be demoted or destroyed through
  # the model, so the existing one is deleted outright to make room.
  def make_root(id)
    @project.divisions.where(is_root: true).delete_all
    @project.divisions.create!(id: id, ref: "placeholder", source: "<p/>",
                               source_format: "pretext", is_root: true, division_type: "book")
    @project.divisions.reload
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

    root = Content.find(ROOT_ID)
    assert_equal "projected-root", root.ref
    assert_equal "<p>The projected book.</p>", root.source
    assert_equal "pretext", root.source_format

    child = Content.find(CHILD_ID)
    assert_equal "projected-ch1", child.ref
    assert_equal "latex", child.source_format
    assert_equal "The first chapter.", child.source
  end

  # A division's element is built from these, never from its source.
  test "the fields a division's element is built from are written to its columns" do
    ProjectDoc.seed(@project, fixture("projection_state"))

    project!

    child = Content.find(CHILD_ID)
    assert_equal "chapter", child.division_type
    assert_equal "Chapter One", child.title
    assert_equal({ "component" => "teacher" }, child.attrs)
  end

  test "a division the project already has is updated rather than duplicated" do
    @project.divisions.create!(id: ROOT_ID, ref: "stale", source: "<p/>", source_format: "pretext")
    ProjectDoc.seed(@project, fixture("projection_state"))

    assert_difference("@project.divisions.count", 1) do # only the child is new
      project!
    end

    assert_equal "projected-root", Content.find(ROOT_ID).ref
  end

  test "tombstones remove the records they name" do
    @project.divisions.create!(id: GONE_DIVISION_ID, ref: "gone", source: "<section/>", source_format: "pretext")
    @project.assets.create!(id: GONE_ASSET_ID, ref: "gone-asset", kind: :authored_asset)
    ProjectDoc.seed(@project, fixture("projection_state"))

    project!

    assert_not Content.exists?(GONE_DIVISION_ID)
    assert_not Content.exists?(GONE_ASSET_ID)
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
    assert_not Content.exists?(GONE_DIVISION_ID)
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
    assert_not Content.find(ROOT_ID).is_root, "a projected division must not claim the root"
  end

  # ---- the root's type ----
  #
  # What Project#structural_document_type reads: the root division's own type,
  # which the editor keeps on the root's entry like any other division's.

  test "the root division's type in the document becomes its division_type" do
    make_root ROOT_ID
    ProjectDoc.seed(@project, fixture("projection_state"))

    project!

    assert_equal "book", @project.reload.structural_document_type,
      "the document says its root is a <book>, so that is what the project is"
  end

  test "a type that is not a root element is refused for the root, and only for the root" do
    # The projected *child* is a latex chapter. Pointing the project's root at it
    # is the shape of a document whose root carries a non-root type -- not an
    # answer to "article or book", and not one the root may be saved with. The
    # refusal costs that one record: the rest of the document still projects.
    make_root CHILD_ID
    ProjectDoc.seed(@project, fixture("projection_state"))

    projection = ProjectDocProjection.new(@project)
    assert projection.apply!

    assert_equal "book", @project.reload.structural_document_type
    assert_equal "placeholder", Content.find(CHILD_ID).ref, "the refused root keeps its row as it was"
    assert_equal "projected-root", Content.find(ROOT_ID).ref, "the other division still projects"
    assert_equal [ CHILD_ID ], projection.issues.map { |i| i["id"] }
    assert_match(/root element/, projection.issues.first["reason"])
    assert_equal projection.issues, @project.projection_issues
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

  # ---- snippets and assets ----
  #
  # Their source is shared text in the document, edited in the same code editor
  # as a division's, so it reaches the rows the same way.

  test "snippets are written from the document, including ones the editor minted" do
    ProjectDoc.seed(@project, fixture("projection_records_state"))

    project!

    snippet = Content.find(SNIPPET_ID)
    assert_equal @project.id, snippet.project_id
    assert_equal "projected-note", snippet.ref
    assert_equal "A Projected Note", snippet.title
    assert_equal "A \\emph{projected} note.", snippet.source
    assert_equal "latex", snippet.source_format
  end

  test "an asset the project has takes its text from the document" do
    @project.assets.create!(id: ASSET_ID, ref: "stale-plot", kind: :authored_asset, title: "Stale", source: "")
    ProjectDoc.seed(@project, fixture("projection_records_state"))

    project!

    asset = Content.find(ASSET_ID)
    assert_equal "projected-plot", asset.ref
    assert_equal "Projected Plot", asset.title
    assert_equal "<latex-image>p</latex-image>", asset.source
    assert_equal "A plot of the projection", asset.short_description
  end

  test "an asset the project lacks is never created by a projection" do
    ProjectDoc.seed(@project, fixture("projection_records_state"))

    assert_no_difference("Content.assets.count") { project! }
    assert_not Content.exists?(UNKNOWN_ASSET_ID),
      "an asset row comes from its upload; a projection has no file to give it"
  end

  test "a snippet tombstone removes the snippet" do
    @project.snippets.create!(id: GONE_SNIPPET_ID, ref: "gone-note", source: "", source_format: "pretext")
    ProjectDoc.seed(@project, fixture("projection_records_state"))

    project!

    assert_not Content.exists?(GONE_SNIPPET_ID)
  end

  test "exercises are written from the document, body and attributes both" do
    ProjectDoc.seed(@project, fixture("projection_records_state"))

    project!

    exercise = Content.find(EXERCISE_ID)
    assert exercise.exercise?
    assert_equal @project.id, exercise.project_id
    assert_equal "projected-quiz", exercise.ref
    assert_equal "A Projected Quiz", exercise.title
    assert_equal "<statement><p>Order the lines.</p></statement>", exercise.source
    assert_equal({ "language" => "python" }, exercise.attrs)
    # An entry with no sourceFormat is a PreTeXt exercise, as every entry was before the field.
    assert exercise.pretext_source_format?
  end

  test "a Doenet activity is written with its format and its interactive's attributes" do
    ProjectDoc.seed(@project, fixture("projection_records_state"))

    project!

    activity = Content.find(DOENET_EXERCISE_ID)
    assert activity.exercise?
    assert activity.doenetml_source_format?
    assert_equal "projected-drag", activity.ref
    assert_equal "<p>What is <m>2+2</m>? <answer>4</answer></p>", activity.source
    assert_equal({ "width" => "100%", "aspect" => "4:3" }, activity.attrs)
  end

  test "an exercise tombstone removes the exercise" do
    @project.exercises.create!(id: GONE_EXERCISE_ID, ref: "gone-quiz", source: "")
    ProjectDoc.seed(@project, fixture("projection_records_state"))

    project!

    assert_not Content.exists?(GONE_EXERCISE_ID)
  end

  # ---- tolerating a bad record ----
  #
  # The document accepts any write. Twice in production one malformed entry
  # made the whole projection raise, which froze every row of the project for a
  # day while the editor kept showing the edits. A bad record now costs itself
  # only, and is listed on the project so something can say so.

  HEALTHY_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd0".freeze
  SPACED_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1".freeze
  TWIN_LOW_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2".freeze
  TWIN_HIGH_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3".freeze
  KEEPER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0".freeze
  NEWCOMER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1".freeze
  WANTS_ASSET_REF_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2".freeze
  REBORN_ID = "12121212-1212-4121-8121-121212121212".freeze
  SWAP_A_ID = "13131313-1313-4131-8131-131313131313".freeze
  SWAP_B_ID = "14141414-1414-4141-8141-141414141414".freeze
  CHAIN_A_ID = "15151515-1515-4151-8151-151515151515".freeze
  CHAIN_B_ID = "16161616-1616-4161-8161-161616161616".freeze

  def seed_issues!
    @project.assets.create!(id: ASSET_ID, ref: "stale-plot", kind: :authored_asset,
                            title: "Stale", source: "<latex-image>s</latex-image>", short_description: "kept")
    @project.divisions.create!(id: KEEPER_ID, ref: "kept", source: "<p>row</p>", source_format: "pretext")
    ProjectDoc.seed(@project, fixture("projection_issues_state"))
  end

  def projection!
    ProjectDocProjection.new(@project).tap(&:apply!)
  end

  test "an asset entry emptied of every field is skipped and its row is untouched" do
    seed_issues!

    projection = projection!

    asset = Content.find(ASSET_ID)
    assert_equal "stale-plot", asset.ref
    assert_equal "Stale", asset.title
    assert_equal "<latex-image>s</latex-image>", asset.source
    assert_equal "kept", asset.short_description
    issue = projection.issues.find { |i| i["id"] == ASSET_ID }
    assert_equal({ "kind" => "asset", "id" => ASSET_ID, "ref" => nil, "reason" => "It needs an ID",
                   "detail" => "ref is missing" }, issue)
  end

  test "a division whose xml:id is not a valid ref is skipped and listed" do
    seed_issues!

    projection = projection!

    assert_not Content.exists?(SPACED_ID)
    issue = projection.issues.find { |i| i["id"] == SPACED_ID }
    assert_equal "division", issue["kind"]
    assert_equal "sec-chapter 1 ", issue["ref"]
    assert_match(/isn't valid/, issue["reason"])
    assert_match(/invalid/, issue["detail"])
  end

  test "the rest of the document still projects around the bad entries" do
    seed_issues!

    projection!

    assert_equal "Issues", @project.reload.title
    healthy = Content.find(HEALTHY_ID)
    assert_equal "healthy-section", healthy.ref
    assert_equal "<p>Still projected.</p>", healthy.source
  end

  test "two new records wanting one ref: the lower id is written, the other listed" do
    seed_issues!

    projection = projection!

    assert_equal "twins", Content.find(TWIN_LOW_ID).ref
    assert_not Content.exists?(TWIN_HIGH_ID)
    issue = projection.issues.find { |i| i["id"] == TWIN_HIGH_ID }
    assert_equal "This ID is already used by another division", issue["reason"]
    assert_equal "ref is already used by division #{TWIN_LOW_ID}", issue["detail"]
  end

  test "a new record wanting an existing row's ref: the row keeps it, the newcomer is listed" do
    seed_issues!

    projection = projection!

    assert_equal "kept", Content.find(KEEPER_ID).ref
    assert_equal "<p>keeper</p>", Content.find(KEEPER_ID).source, "the keeper's own entry still projects"
    assert_not Content.exists?(NEWCOMER_ID)
    assert_includes projection.issues.map { |i| i["id"] }, NEWCOMER_ID
  end

  test "a record wanting the ref of a row the document leaves alone is listed" do
    # The emptied asset's entry was skipped, so its row keeps `stale-plot`; a
    # division that wants that ref would be refused by the index, so it loses.
    seed_issues!

    projection = projection!

    assert_not Content.exists?(WANTS_ASSET_REF_ID)
    issue = projection.issues.find { |i| i["id"] == WANTS_ASSET_REF_ID }
    assert_equal "This ID is already used by another image", issue["reason"]
    assert_equal "ref is already used by asset #{ASSET_ID}", issue["detail"]
  end

  test "the outcome is recorded on the project, and is the same on every run" do
    seed_issues!

    first = projection!
    @project.reload
    assert_equal first.issues, @project.projection_issues
    assert_equal %w[ asset division division division division ], @project.projection_issues.map { |i| i["kind"] }
    assert_in_delta Time.current, @project.projection_checked_at, 5.seconds

    second = projection!
    assert_equal first.issues, second.issues
    assert_equal first.issues, @project.reload.projection_issues
  end

  test "a healthy document leaves the issues empty and stamps the check" do
    ProjectDoc.seed(@project, fixture("projection_state"))

    project!

    @project.reload
    assert_equal [], @project.projection_issues
    assert_not_nil @project.projection_checked_at
  end

  test "new issues are reported once, not on every run" do
    seed_issues!
    notified = []

    Honeybadger.stub(:notify, ->(*args, **kwargs) { notified << [ args, kwargs ] }) do
      projection!
      projection!
    end

    assert_equal 1, notified.size
    _args, kwargs = notified.first
    assert_equal "Collab::ProjectionIssues", kwargs[:error_class]
    assert_equal "projection-#{@project.id}", kwargs[:fingerprint]
    assert_equal 5, kwargs.dig(:context, :issues).size
  end

  test "a reset document clears issues recorded against it" do
    seed_issues!
    projection!
    assert @project.reload.projection_issues.any?

    ProjectDoc.reset!(@project)
    assert_not project!

    assert_equal [], @project.reload.projection_issues
  end

  # ---- refs that are legal but awkward ----
  #
  # Refs are unique per project, and a nested save validates every record
  # before it writes any. So a removed record's ref reused by a new one, or two
  # refs swapped, would each be refused as "already taken" unless written in an
  # order that frees the ref first.

  def seed_renames!
    @project.divisions.create!(id: GONE_DIVISION_ID, ref: "reborn", source: "", source_format: "pretext")
    @project.divisions.create!(id: SWAP_A_ID, ref: "swap-a", source: "", source_format: "pretext")
    @project.divisions.create!(id: SWAP_B_ID, ref: "swap-b", source: "", source_format: "pretext")
    @project.divisions.create!(id: CHAIN_A_ID, ref: "chain-a", source: "", source_format: "pretext")
    @project.divisions.create!(id: CHAIN_B_ID, ref: "chain-b", source: "", source_format: "pretext")
    ProjectDoc.seed(@project, fixture("projection_renames_state"))
  end

  test "a tombstone plus a new record reusing its ref projects cleanly" do
    seed_renames!

    projection = projection!

    assert_not Content.exists?(GONE_DIVISION_ID)
    assert_equal "reborn", Content.find(REBORN_ID).ref
    assert_empty projection.issues
  end

  test "swapping the refs of two divisions projects cleanly" do
    seed_renames!

    projection!

    assert_equal "swap-b", Content.find(SWAP_A_ID).ref
    assert_equal "swap-a", Content.find(SWAP_B_ID).ref
  end

  test "a chain of renames projects cleanly, and leaves nothing parked" do
    seed_renames!

    projection!

    assert_equal "chain-b", Content.find(CHAIN_A_ID).ref
    assert_equal "chain-c", Content.find(CHAIN_B_ID).ref
    assert_empty @project.contents.where("ref LIKE 'tmp\\_%'"), "no row is left at its parking ref"
  end

  test "renames settle on the first run and change nothing on the second" do
    seed_renames!
    projection!
    @project.reload
    settled = @project.source_updated_at

    travel 1.minute do
      projection!
    end

    assert_equal settled, @project.reload.source_updated_at
  end

  test "a parked row that is then refused is left where its issue says" do
    # CHAIN_B holds `chain-b`, which CHAIN_A wants, so it is parked first. As
    # the root it is then refused (its entry says "section"), and by then
    # CHAIN_A has `chain-b`, so there is nowhere to give it back.
    make_root CHAIN_B_ID
    Content.find(CHAIN_B_ID).update_columns(ref: "chain-b")
    @project.divisions.create!(id: CHAIN_A_ID, ref: "chain-a", source: "", source_format: "pretext")
    ProjectDoc.seed(@project, fixture("projection_renames_state"))

    projection = projection!

    assert_equal "chain-b", Content.find(CHAIN_A_ID).ref
    assert_equal ProjectDocProjection.parking_ref(CHAIN_B_ID), Content.find(CHAIN_B_ID).ref
    issue = projection.issues.find { |i| i["id"] == CHAIN_B_ID }
    assert_match(/root element/, issue["reason"])
    assert_match(/parked at tmp_16161616/, issue["detail"])
    assert_no_match(/parked/, issue["reason"], "the author is not told about parking refs")
  end
end
