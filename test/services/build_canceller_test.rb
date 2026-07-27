require "test_helper"

class BuildCancellerTest < ActiveSupport::TestCase
  def http_response(klass, code, body = "")
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

  def stub_cancel(response, &blk)
    Net::HTTP.stub(:start, ->(*_args, **_kw) { response }, &blk)
  end

  test "a successful cancel marks the build canceled" do
    result = stub_cancel(http_response(Net::HTTPOK, "200")) do
      BuildCanceller.new(build).cancel!
    end

    assert result.ok?
    assert build.reload.canceled?
    assert_equal BuildCanceller::CANCEL_LOG, build.log
  end

  # The status URL the server handed back is a path relative to itself, and /cancel hangs
  # off it -- resolving it against the wrong host is how this would silently POST to
  # pretext.plus instead.
  test "the cancel goes to the build server's cancel endpoint" do
    requested = nil
    FullBuildServer.stub(:post, ->(path) { requested = path; http_response(Net::HTTPOK, "200") }) do
      BuildCanceller.new(build).cancel!
    end

    assert_equal "/builds/job-123/cancel", requested
    assert_equal "https://#{Rails.application.credentials.dig(:full_build, :host)}/builds/job-123/cancel",
                 FullBuildServer.url_for(requested)
  end

  # Never submitted -- it is still sitting in our own queue, so there is nothing on the
  # build server to stop and no request to make.
  test "a build with no status URL is canceled without calling the server" do
    build.update_column(:remote_status_url, nil)

    result = Net::HTTP.stub(:start, ->(*_args, **_kw) { flunk "should not call the build server" }) do
      BuildCanceller.new(build).cancel!
    end

    assert result.ok?
    assert build.reload.canceled?
  end

  # Cancelling races a build that was already finishing, and a job that aged out of the
  # server's store is gone too. Either way it is not coming back.
  test "a job the server no longer has is still canceled here" do
    result = stub_cancel(http_response(Net::HTTPConflict, "409")) do
      BuildCanceller.new(build).cancel!
    end

    assert result.ok?
    assert build.reload.canceled?
    assert_match(/already finished/, result.message)
  end

  # Something may genuinely still be running over there, so claiming otherwise would be a
  # lie -- and leaving it in flight keeps it under BuildWatchdogJob.
  test "an erroring build server leaves the build in flight" do
    result = stub_cancel(http_response(Net::HTTPInternalServerError, "500")) do
      BuildCanceller.new(build).cancel!
    end

    assert_not result.ok?
    assert build.reload.in_progress?
    assert_match(/still be running/, result.message)
  end

  test "an unreachable build server leaves the build in flight" do
    result = Net::HTTP.stub(:start, ->(*_args, **_kw) { raise "network error" }) do
      BuildCanceller.new(build).cancel!
    end

    assert_not result.ok?
    assert build.reload.in_progress?
  end

  test "a build that already finished is not cancelable" do
    build.mark!(:success)

    result = BuildCanceller.new(build).cancel!

    assert_not result.ok?
    assert build.reload.success?
  end
end
