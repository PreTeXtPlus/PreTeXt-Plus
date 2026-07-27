require "test_helper"

class FullBuildLogJobTest < ActiveJob::TestCase
  LOG_URL = "/builds/job-123/log".freeze

  def http_response(klass, code, body)
    res = klass.new("1.1", code, "")
    res.instance_variable_set(:@read, true)
    res.define_singleton_method(:body) { body }
    res
  end

  def stub_log(response, &blk)
    Net::HTTP.stub(:start, ->(*_args, **_kw) { response }, &blk)
  end

  def build
    builds(:in_progress)
  end

  test "replaces the callback's tail with the full log" do
    build.mark!(:failed, log: "...the last 4000 characters")
    response = http_response(Net::HTTPOK, "200", "the whole log, from the top")

    stub_log(response) { FullBuildLogJob.perform_now(build, LOG_URL) }

    assert_equal "the whole log, from the top", build.reload.log
  end

  # The artifact import races this job, and whichever lands second must not undo the
  # other: the log is this job's to write, the status is not.
  test "does not move a build that succeeded while the fetch was in flight" do
    build.mark!(:success)
    response = http_response(Net::HTTPOK, "200", "the whole log")

    stub_log(response) { FullBuildLogJob.perform_now(build, LOG_URL) }

    assert build.reload.success?
    assert_equal "the whole log", build.log
  end

  test "keeps the tail when the server will not hand over the log" do
    build.mark!(:failed, log: "the tail")
    response = http_response(Net::HTTPInternalServerError, "500", "boom")

    stub_log(response) { FullBuildLogJob.perform_now(build, LOG_URL) }

    assert_equal "the tail", build.reload.log
  end

  test "keeps the tail when the log comes back empty" do
    build.mark!(:failed, log: "the tail")
    response = http_response(Net::HTTPOK, "200", "")

    stub_log(response) { FullBuildLogJob.perform_now(build, LOG_URL) }

    assert_equal "the tail", build.reload.log
  end

  # A build log is not worth a retry storm, and the tail is already on the record.
  test "swallows a timeout rather than failing the job" do
    build.mark!(:failed, log: "the tail")

    Net::HTTP.stub(:start, ->(*_args, **_kw) { raise Net::ReadTimeout }) do
      assert_nothing_raised { FullBuildLogJob.perform_now(build, LOG_URL) }
    end

    assert_equal "the tail", build.reload.log
  end
end
