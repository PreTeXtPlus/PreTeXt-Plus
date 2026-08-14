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
