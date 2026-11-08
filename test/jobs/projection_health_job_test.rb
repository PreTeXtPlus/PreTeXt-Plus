require "test_helper"

# Every test here is a document whose rows may have stopped following it in a
# different way, because the whole point of the job is the cases nobody is
# otherwise told about.
class ProjectionHealthJobTest < ActiveJob::TestCase
  setup do
    @project = projects(:one)
  end

  def fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  def seed!(project = @project)
    ProjectDoc.seed(project, fixture("projection_state"))
    Y::Document.find_by(key: ProjectDoc.key_for(project))
  end

  # Runs the job and returns the context of the one notice it sent, or nil.
  def report
    notices = []
    Honeybadger.stub(:notify, ->(*_args, **kwargs) { notices << kwargs }) do
      ProjectionHealthJob.perform_now
    end
    assert_operator notices.size, :<=, 1, "one summary, not one notice per finding"
    notices.first&.dig(:context)
  end

  test "a healthy, freshly projected document is nothing to report" do
    seed!
    ProjectDocProjection.new(@project).apply!

    assert_nil report
  end

  test "a project whose last projection left records out is reported" do
    @project.update_columns(projection_issues: [ { "kind" => "division", "id" => "x", "ref" => "a b", "reason" => "invalid" } ])

    assert_equal [ @project.id ], report[:projects_with_issues]
  end

  test "a document with an update row quarantined for over an hour is reported" do
    document = seed!
    ProjectDocProjection.new(@project).apply!
    Y::DocumentUpdate.create!(document_id: document.id, payload: fixture("one_update"), pending: true,
                              created_at: 2.hours.ago)

    assert_equal [ @project.id ], report[:projects_with_stale_pending_updates]
  end

  test "a quarantined row younger than an hour is given time to resolve" do
    document = seed!
    ProjectDocProjection.new(@project).apply!
    Y::DocumentUpdate.create!(document_id: document.id, payload: fixture("one_update"), pending: true)

    assert_nil report
  end

  test "a document written to since its last projection, by more than the tolerance, is reported" do
    seed!
    ProjectDocProjection.new(@project).apply!
    @project.update_columns(projection_checked_at: 1.hour.ago)
    Y::Document.find_by(key: ProjectDoc.key_for(@project)).update_column(:updated_at, 10.minutes.ago)

    assert_equal [ @project.id ], report[:projects_whose_projection_lags]
  end

  test "a document never projected since the column existed is reported while it is active" do
    seed!
    @project.update_columns(projection_checked_at: nil)

    assert_equal [ @project.id ], report[:projects_whose_projection_lags]
  end

  test "a document quiet for longer than the activity window is left alone" do
    document = seed!
    @project.update_columns(projection_checked_at: nil)
    document.update_column(:updated_at, (ProjectionHealthJob::ACTIVITY_WINDOW + 1.day).ago)

    assert_nil report
  end

  test "a document that is not a project's is ignored" do
    Y::Document.create!(key: "something/else", state: fixture("projection_state"))

    assert_nil report
  end
end
