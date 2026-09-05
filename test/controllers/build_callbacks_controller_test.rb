require "test_helper"

# The webhook is the only path most builds ever take, so what it reads out of the
# payload is what an author sees. It read a key the build server does not send for long
# enough that every build in the system recorded the same placeholder log.
class BuildCallbacksControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @build = builds(:in_progress)
    @project = @build.project
  end

  def secret
    Rails.application.credentials.dig(:full_build, :webhook_secret)
  end

  def post_callback(payload, sign_with: secret)
    body = payload.to_json
    signature = OpenSSL::HMAC.hexdigest("SHA256", sign_with.to_s, body)

    post full_callback_project_build_url(@project, @build),
         params: body,
         headers: { "Content-Type" => "application/json",
                    "X-PreTeXt-Signature" => "sha256=#{signature}" }
  end

  # The payload shape is notify.py's _build_payload: log_tail + log_truncated + log_url,
  # never a bare "log".
  def failure_payload(**overrides)
    { "job_id" => "job-123", "status" => "failed", "target" => "web", "exit_code" => 1,
      "log_tail" => "ERROR external/fig-hasse.svg not found",
      "log_truncated" => false,
      "log_url" => "/builds/job-123/log" }.merge(overrides)
  end

  def success_payload(**overrides)
    failure_payload("status" => "success", "exit_code" => 0,
                    "artifact_url" => "/builds/job-123/artifact").merge(overrides)
  end

  test "a failure records the log tail the server actually sent" do
    post_callback(failure_payload)

    assert_response :success
    assert @build.reload.failed?
    assert_equal "ERROR external/fig-hasse.svg not found", @build.log
  end

  test "a success records the log tail too" do
    post_callback(success_payload)

    assert @build.reload.received_from_server?
    assert_equal "ERROR external/fig-hasse.svg not found", @build.log
  end

  test "a success enqueues the artifact import against the build server's host" do
    assert_enqueued_with(job: FullBuildArtifactJob) do
      post_callback(success_payload)
    end

    _build, artifact_url = enqueued_jobs.find { |j| j["job_class"] == "FullBuildArtifactJob" }["arguments"]
    assert_equal "https://#{Rails.application.credentials.dig(:full_build, :host)}/builds/job-123/artifact",
                 artifact_url
  end

  # Since the build server's "keep output if it exists" change, a nonzero exit still
  # zips whatever landed in output/ and the payload still carries artifact_url. The
  # presence of that key, not the status word, is what decides there is an import to do.
  test "a failure that still produced output is imported and flagged" do
    assert_enqueued_with(job: FullBuildArtifactJob) do
      post_callback(failure_payload("artifact_url" => "/builds/job-123/artifact"))
    end

    assert_response :success
    assert @build.reload.received_from_server?
    assert @build.completed_with_errors?
    assert_equal "ERROR external/fig-hasse.svg not found", @build.log
  end

  test "a failure with no output imports nothing and stays failed" do
    assert_no_enqueued_jobs(only: FullBuildArtifactJob) do
      post_callback(failure_payload)
    end

    assert @build.reload.failed?
    assert_not @build.completed_with_errors?
  end

  # The flag is about the build server's verdict, not about ours: a clean build must
  # never pick it up on the way through.
  test "a success is not flagged" do
    post_callback(success_payload)

    assert_not @build.reload.completed_with_errors?
  end

  test "a failure with output still fetches the rest of a truncated log" do
    assert_enqueued_with(job: FullBuildLogJob, args: [ @build, "/builds/job-123/log" ]) do
      post_callback(failure_payload("artifact_url" => "/builds/job-123/artifact",
                                    "log_truncated" => true))
    end
  end

  # The tail is capped at CALLBACK_LOG_TAIL_CHARS server-side; the rest is fetched out of
  # band so a slow log endpoint can't stall the response into the server's retry.
  test "a truncated log is completed by a background fetch" do
    assert_enqueued_with(job: FullBuildLogJob, args: [ @build, "/builds/job-123/log" ]) do
      post_callback(failure_payload("log_truncated" => true))
    end
  end

  test "an untruncated log needs no follow-up fetch" do
    post_callback(failure_payload("log_truncated" => false))

    assert_no_enqueued_jobs(only: FullBuildLogJob)
  end

  test "a payload with no log at all falls back to the placeholder" do
    post_callback(failure_payload("log_tail" => ""))

    assert_equal "(No log returned from server.)", @build.reload.log
  end

  # A status word we do not understand records nothing, which on the dashboard looks
  # exactly like a build that never finished. It must at least leave a trace saying so.
  test "a status the server has invented is acknowledged, logged, and changes nothing" do
    logged = []
    Rails.logger.stub(:warn, ->(message) { logged << message }) do
      post_callback(success_payload("status" => "completed"))
    end

    assert_response :success
    assert @build.reload.in_progress?
    assert_match(/"completed"/, logged.join("\n"))
  end

  # BuildStatusChecker#check! polls the same server this callback describes, and can
  # win the race to an answer if a build finishes fast enough -- see BuildRecheckJob's
  # early schedule. If it already claimed this build, the webhook must not import the
  # same artifact a second time: that collides on BuildFile's unique index and marks
  # a build that actually succeeded failed.
  test "a callback for a build the poll already claimed is acknowledged but changes nothing" do
    @build.mark!(:received_from_server, log: "Success! Built requested target(s) without errors.")

    assert_no_enqueued_jobs(only: FullBuildArtifactJob) do
      post_callback(success_payload)
    end

    assert_response :success
    assert @build.reload.received_from_server?
    assert_equal "Success! Built requested target(s) without errors.", @build.log
  end

  test "a callback for a canceled build is acknowledged but changes nothing" do
    @build.mark!(:canceled, log: "Build canceled.")

    assert_no_enqueued_jobs(only: FullBuildArtifactJob) do
      post_callback(success_payload)
    end

    assert_response :success
    assert @build.reload.canceled?
  end

  test "a callback signed with the wrong secret is rejected" do
    post_callback(failure_payload, sign_with: "not-the-secret")

    assert_response :unauthorized
    assert @build.reload.in_progress?
  end
end
