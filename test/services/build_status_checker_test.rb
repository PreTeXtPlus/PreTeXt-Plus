require "test_helper"

# The manual fallback for when the webhook never arrived. Unlike the callback payload,
# GET /builds/<job> hands back the server's whole job record -- including the complete
# log -- so this path records it directly rather than fetching it again.
class BuildStatusCheckerTest < ActiveJob::TestCase
  def http_response(klass, code, body)
    res = klass.new("1.1", code, "")
    res.instance_variable_set(:@read, true)
    res.define_singleton_method(:body) { body }
    res
  end

  def build
    @build ||= builds(:in_progress).tap do |b|
      b.update_column(:remote_status_url, "/builds/job-123")
    end
  end

  def stub_status(payload, &blk)
    response = http_response(Net::HTTPOK, "200", payload.to_json)
    Net::HTTP.stub(:start, ->(*_args, **_kw) { response }, &blk)
  end

  test "a server-side success records the log and imports the artifact" do
    result = stub_status("status" => "success", "log" => "the whole build log",
                         "artifact_url" => "/builds/job-123/artifact") do
      BuildStatusChecker.new(build).check!
    end

    assert result.ok?
    assert build.reload.received_from_server?
    assert_equal "the whole build log", build.log
    assert_enqueued_with(job: FullBuildArtifactJob,
                         args: [ build, "https://#{Rails.application.credentials.dig(:full_build, :host)}/builds/job-123/artifact" ])
  end

  test "a server-side failure records the log" do
    result = stub_status("status" => "failed", "log" => "ERROR fig-hasse.svg not found") do
      BuildStatusChecker.new(build).check!
    end

    assert_not result.ok?
    assert build.reload.failed?
    assert_equal "ERROR fig-hasse.svg not found", build.log
  end

  # The build server zips output/ whatever the exit code was, so a failure that carries
  # an artifact_url has output worth importing -- flagged, not thrown away.
  test "a server-side failure that still produced output imports it and flags the build" do
    result = stub_status("status" => "failed", "exit_code" => 1, "log" => "ERROR one figure is missing",
                         "artifact_url" => "/builds/job-123/artifact") do
      BuildStatusChecker.new(build).check!
    end

    assert result.ok?
    assert_match(/reported errors/, result.message)
    assert build.reload.received_from_server?
    assert build.completed_with_errors?
    assert_enqueued_with(job: FullBuildArtifactJob,
                         args: [ build, "https://#{Rails.application.credentials.dig(:full_build, :host)}/builds/job-123/artifact" ])
  end

  test "an already-imported build with errors reports the warning rather than a plain success" do
    build.mark!(:success, completed_with_errors: true)

    result = Net::HTTP.stub(:start, ->(*_args, **_kw) { flunk "should not call the build server" }) do
      BuildStatusChecker.new(build).check!
    end

    assert result.ok?
    assert_match(/reported errors/, result.message)
  end

  # The webhook and a poll can both be asking the same question at once -- see
  # BuildRecheckJob's early schedule, which now checks back seconds after a build
  # starts rather than half a minute in. If the webhook wins while this request was
  # still on the wire, importing the artifact a second time here would collide with
  # it on BuildFile's unique index and mark! a build that actually succeeded failed.
  test "a build the webhook already moved past sent_to_server while this was in flight is left alone" do
    result = stub_status("status" => "success", "log" => "the whole build log",
                         "artifact_url" => "/builds/job-123/artifact") do
      build.update_column(:status, Build.statuses.fetch("received_from_server"))
      BuildStatusChecker.new(build).check!
    end

    assert result.ok?
    assert_no_enqueued_jobs(only: FullBuildArtifactJob)
  end

  # The status GET, with something else settling the build while it is on the wire. The
  # change is made to the database only, so the checker's own copy still looks waiting,
  # which is exactly what it saw in production.
  def stub_status_meanwhile(payload, meanwhile, &blk)
    response = http_response(Net::HTTPOK, "200", payload.to_json)
    Net::HTTP.stub(:start, ->(*_args, **_kw) { meanwhile.call; response }, &blk)
  end

  def settle_in_database(status)
    -> { Build.where(id: build.id).update_all(status: Build.statuses.fetch(status)) }
  end

  # The webhook claimed the build and its import finished, all before this poll's answer
  # came back. Only checking for received_from_server let this through: the poll moved
  # a finished build back and queued a second import of it.
  test "a build whose import finished while this was in flight is not imported again" do
    result = stub_status_meanwhile({ "status" => "success", "log" => "the whole build log",
                                     "artifact_url" => "/builds/job-123/artifact" },
                                   settle_in_database("success")) do
      BuildStatusChecker.new(build).check!
    end

    assert result.ok?
    assert_equal "Build was successful!", result.message
    assert build.reload.success?
    assert_no_enqueued_jobs(only: FullBuildArtifactJob)
  end

  test "a build canceled while this was in flight stays canceled" do
    result = stub_status_meanwhile({ "status" => "failed", "log" => "ERROR boom" },
                                   settle_in_database("canceled")) do
      BuildStatusChecker.new(build).check!
    end

    assert_not result.ok?
    assert_equal "This build was canceled.", result.message
    assert build.reload.canceled?
  end

  test "a build still running is reported, not moved" do
    result = stub_status("status" => "running") { BuildStatusChecker.new(build).check! }

    assert result.ok?
    assert_match(/running/, result.message)
    assert build.reload.in_progress?
  end

  test "a canceled build is not polled" do
    build.mark!(:canceled)

    result = Net::HTTP.stub(:start, ->(*_args, **_kw) { flunk "should not call the build server" }) do
      BuildStatusChecker.new(build).check!
    end

    assert_not result.ok?
    assert_match(/canceled/, result.message)
  end

  test "an unreachable build server is reported rather than raised" do
    result = Net::HTTP.stub(:start, ->(*_args, **_kw) { raise "network error" }) do
      BuildStatusChecker.new(build).check!
    end

    assert_not result.ok?
    assert_match(/Couldn't reach the build server/, result.message)
    assert build.reload.in_progress?
  end
end
