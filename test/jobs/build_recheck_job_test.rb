require "test_helper"

# The whole point of this job is the cases nobody is told about, so every test here is a
# build that has gone quiet in a different way.
class BuildRecheckJobTest < ActiveJob::TestCase
  def build
    builds(:in_progress)
  end

  def stream_for(build)
    Turbo::StreamsChannel.send(:stream_name_from, [ build.project, :targets ])
  end

  # A build server that reports success only moves a build to `received_from_server`;
  # nothing gets it out of Building except the artifact import. So the check has to look
  # past the status the callback wrote.
  test "a finished build is re-broadcast for anyone who missed the first message" do
    build.mark!(:success)

    broadcasts = capture_broadcasts(stream_for(build)) do
      perform_enqueued_jobs { BuildRecheckJob.perform_now(build) }
    end

    row, drawer = broadcasts.partition { |b| b.include?("turbo-stream action=\"replace\"") }
    assert_equal 1, row.size
    assert_equal 1, drawer.size
    assert_match(/id="#{ActionView::RecordIdentifier.dom_id(build.target)}"/, row.first)
  end

  test "a finished build is not chased any further" do
    build.mark!(:failed)

    assert_no_enqueued_jobs(only: BuildRecheckJob) { BuildRecheckJob.perform_now(build) }
  end

  # The dropped-webhook case: the server has an answer and never managed to tell us.
  test "a build still waiting on the server is polled, and marked from what it says" do
    build.mark!(:sent_to_server)
    build.update_column(:remote_status_url, "/builds/job-123/status")

    checked = false
    BuildStatusChecker.stub(:new, ->(polled) {
      assert_equal build, polled
      checked = true
      # Stands in for the real checker, which marks the build itself from the server's
      # answer -- that part has its own tests.
      Object.new.tap { |c| c.define_singleton_method(:check!) { nil } }
    }) do
      BuildRecheckJob.perform_now(build)
    end

    assert checked, "a build the server owes us an answer for should have been polled"
    assert_enqueued_with(job: BuildRecheckJob, args: [ build, { attempt: 2 } ])
  end

  # Nothing to poll: the build never got far enough to have a job on the build server.
  test "a build that never reached the server is left alone and checked again" do
    build.mark!(:pending)

    BuildStatusChecker.stub(:new, ->(*) { flunk "should not poll a build with no status URL" }) do
      BuildRecheckJob.perform_now(build)
    end

    assert_enqueued_with(job: BuildRecheckJob, args: [ build, { attempt: 2 } ])
  end

  test "an import that has gone quiet for too long stops claiming to be building" do
    build.mark!(:received_from_server, log: "Success!  Built requested target(s) without errors.")
    build.update_column(:updated_at, (BuildRecheckJob::STALL_AFTER + 1.minute).ago)

    BuildRecheckJob.perform_now(build)

    assert build.reload.failed?
    # The CLI's own output is what an author can act on, so it survives; the added line
    # explains a build whose log ends in "Success!" reading as failed.
    assert_match(/Success!/, build.log)
    assert_match(/stopped part way/, build.log)
  end

  # A big site can import for a long while without being stuck. Progress is measured by
  # what the import produces, not by the clock, so a living one is never cut off.
  test "a slow import that is still producing files is left to finish" do
    build.mark!(:received_from_server)
    build.update_column(:updated_at, (BuildRecheckJob::STALL_AFTER + 1.minute).ago)
    build.build_files.create!(relative_path: "index.html")

    BuildRecheckJob.perform_now(build)

    assert build.reload.received_from_server?
    assert_enqueued_with(job: BuildRecheckJob, args: [ build, { attempt: 2 } ])
  end

  test "checking gives up eventually rather than following a build forever" do
    build.mark!(:in_progress)

    assert_no_enqueued_jobs(only: BuildRecheckJob) do
      BuildRecheckJob.perform_now(build, attempt: BuildRecheckJob::MAX_ATTEMPTS)
    end
  end

  # prune_builds! deletes attempts out from under jobs already scheduled against them.
  test "a build deleted before the check runs is discarded, not retried" do
    doomed = build
    BuildRecheckJob.perform_later(doomed)
    doomed.destroy!

    assert_nothing_raised { perform_enqueued_jobs(only: BuildRecheckJob) }
  end
end
