require "test_helper"

class ProjectDocProjectionJobTest < ActiveJob::TestCase
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

  test "a document written to recently is projected into its project's rows" do
    seed!
    ProjectDoc.record(ProjectDoc.key_for(@project), fixture("one_update"))

    ProjectDocProjectionJob.perform_now

    assert_equal "Projected Title", @project.reload.title
  end

  # Compaction deletes the update rows it folds into the snapshot, so a document
  # edited and then compacted between two runs has no tail left to find it by.
  # The document's own timestamp is the second signal, and this is the case that
  # needs it.
  test "a document whose tail has been compacted away is still projected" do
    document = seed!
    assert_equal 0, Y::DocumentUpdate.where(document_id: document.id).count,
      "a freshly seeded document has no tail; this test would be vacuous with one"

    ProjectDocProjectionJob.perform_now

    assert_equal "Projected Title", @project.reload.title
  end

  # The window has to be bounded as well as generous: without that, every
  # project that ever had a collaborative session would be re-projected once a
  # minute for the life of the application.
  test "a document quiet for longer than the lookback is left alone" do
    document = seed!
    quiet = ProjectDocProjectionJob::LOOKBACK.ago - 1.hour
    document.update_column(:updated_at, quiet)
    Y::DocumentUpdate.where(document_id: document.id).update_all(created_at: quiet)

    ProjectDocProjectionJob.perform_now

    assert_not_equal "Projected Title", @project.reload.title
  end

  test "projecting twice changes nothing the second time" do
    seed!
    ProjectDocProjectionJob.perform_now
    settled = @project.reload.source_updated_at

    travel 1.minute do
      assert_no_difference("Division.count") { ProjectDocProjectionJob.perform_now }
    end

    assert_equal settled, @project.reload.source_updated_at,
      "a projection that changes nothing must not make every build target stale"
  end

  # yrby's store is keyed by an opaque string and is not exclusively ours. A key
  # this app did not write is not an error, and must not take the run down with
  # it.
  test "a document that is not a project's is skipped" do
    Y::Document.create!(key: "something/else", state: fixture("projection_state"))

    assert_nothing_raised { ProjectDocProjectionJob.perform_now }
  end

  # One project that will not project must not cost every other project its turn.
  test "a project that raises is reported and the rest still run" do
    seed!
    exploding = ->(project) do
      raise "boom" if project.id == @project.id

      Struct.new(:apply!).new(true)
    end

    notified = []
    Honeybadger.stub(:notify, ->(e, **_kw) { notified << e }) do
      ProjectDocProjection.stub(:new, exploding) do
        assert_nothing_raised { ProjectDocProjectionJob.perform_now }
      end
    end

    assert_equal 1, notified.size
    assert_equal "boom", notified.first.message
  end
end
