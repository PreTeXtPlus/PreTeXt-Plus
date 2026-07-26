require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  test "enqueue_html_source_job writes placeholder to html_source immediately" do
    project = projects(:one)
    project.enqueue_html_source_job
    assert_equal Project::ENQUEUE_SOURCE_PLACEHOLDER, project.reload.html_source
  end

  test "enqueue_html_source_job enqueues SetHtmlSourceJob" do
    project = projects(:one)
    assert_enqueued_with(job: SetHtmlSourceJob, args: [ project ]) do
      project.enqueue_html_source_job
    end
  end

  test "belongs to user" do
    project = projects(:one)
    assert_equal users(:one), project.user
  end

  test "an existing root division's source can be updated without resending its ref" do
    project = projects(:one)
    division = project.root_division
    stub_build_server do
      project.update!(divisions_attributes: [ { id: division.id, source: "<section><title>Edited</title></section>" } ])
    end
    assert_equal "<section><title>Edited</title></section>", division.reload.source
  end

  test "renaming a division's ref keeps its UUID stable" do
    project = projects(:one)
    division = project.root_division
    original_id = division.id
    stub_build_server do
      project.update!(divisions_attributes: [ { id: original_id, ref: "new-xml-id" } ])
    end
    assert_equal original_id, division.reload.id
    assert_equal "new-xml-id", division.ref
  end

  # ---- source_updated_at ----
  #
  # Regression tests for a confirmed bug: the editor saves through nested
  # divisions_attributes, and because no attribute on the projects row itself changes,
  # Rails never issues an UPDATE on the parent. So `updated_at` reported the last rename
  # rather than the last edit, and build staleness had no timestamp to compare against.

  test "editing a division through nested attributes bumps source_updated_at" do
    project = projects(:one)
    project.update_column(:source_updated_at, 3.days.ago)
    division = project.root_division

    stub_build_server do
      project.update!(divisions_attributes: [ { id: division.id, source: "<section><title>Edited</title></section>" } ])
    end

    assert_operator project.reload.source_updated_at, :>, 1.minute.ago
  end

  test "editing a division also fixes the mis-sorted updated_at" do
    project = projects(:one)
    project.update_column(:updated_at, 3.days.ago)
    division = project.root_division

    stub_build_server do
      project.update!(divisions_attributes: [ { id: division.id, source: "<section><title>Edited</title></section>" } ])
    end

    assert_operator project.reload.updated_at, :>, 1.minute.ago
  end

  test "changing an asset bumps source_updated_at" do
    project = projects(:one)
    project.update_column(:source_updated_at, 3.days.ago)

    assets(:authored_one).update!(source: "<p>new</p>")

    assert_operator project.reload.source_updated_at, :>, 1.minute.ago
  end

  test "changing the docinfo bumps source_updated_at" do
    project = projects(:one)
    project.update_column(:source_updated_at, 3.days.ago)

    project.update!(docinfo: "<docinfo><macros>\\newcommand{\\Z}{\\mathbb Z}</macros></docinfo>")

    assert_operator project.reload.source_updated_at, :>, 1.minute.ago
  end

  # The reason this is a separate column rather than a fix to updated_at: renaming must
  # not mark every built target stale.
  test "renaming a project does not bump source_updated_at" do
    project = projects(:one)
    was = 3.days.ago.change(usec: 0)
    project.update_column(:source_updated_at, was)

    project.update!(title: "A New Title")

    assert_equal was, project.reload.source_updated_at
  end

  # ---- default target ----

  test "a new project is created with a web html target" do
    project = Project.create!(user: users(:one), title: "Fresh")

    assert_equal 1, project.targets.count
    target = project.targets.first
    assert_equal "web", target.name
    assert_equal "website", target.kind
  end

  # The trap this guard exists for: Rails does not re-validate children when the parent
  # changes, so without an explicit check on Project a slideshow could become an article
  # while keeping a reveal.js target that can never build again.
  test "document_type cannot change out from under a target that depends on it" do
    project = projects(:slides)
    assert project.targets.any? { |t| t.kind == "revealjs" }

    assert_not project.update(document_type: :article)
    assert_match(/Slides/, project.errors[:document_type].to_sentence)
    assert_equal "slideshow", project.reload.document_type
  end

  test "document_type may change once nothing depends on it" do
    project = projects(:slides)
    project.targets.where(kind: "revealjs").destroy_all

    assert project.reload.update(document_type: :article)
  end

  test "an unrestricted target does not block a document_type change" do
    project = projects(:one)
    assert project.targets.any?

    assert project.update(document_type: :book)
  end

  test "full_dup copies target configuration but no build history" do
    original = projects(:two)
    assert original.targets.first.update(published: true)

    copy = original.full_dup(users(:one))
    assert copy.save

    assert_equal original.targets.map(&:name).sort, copy.targets.map(&:name).sort
    copy.targets.each do |target|
      assert_not target.published?, "a copy must not inherit the original's public URLs"
      assert_nil target.current_build_id
      assert_empty target.builds
    end
  end
end
