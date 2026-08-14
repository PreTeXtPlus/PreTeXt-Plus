require "openssl"

# Receives async status callbacks from the full build server
# (pretext-plus-build-full). The server is not an authenticated user, so this
# endpoint skips login and CSRF and instead authenticates the request by
# verifying an HMAC-SHA256 signature (X-PreTeXt-Signature) over the raw body,
# using a secret shared with the build server (FULL_BUILD_WEBHOOK_SECRET).
class BuildCallbacksController < ApplicationController
  allow_unauthenticated_access only: :create
  skip_forgery_protection only: :create

  SIGNATURE_HEADER = "X-PreTeXt-Signature".freeze

  NO_LOG = "(No log returned from server.)".freeze

  # POST /projects/:project_id/builds/:id/full_callback
  def create
    body = request.raw_post
    unless valid_signature?(body)
      Rails.logger.warn("Build callback for build #{params[:id]} rejected: invalid or missing #{SIGNATURE_HEADER} -- check FULL_BUILD_WEBHOOK_SECRET matches the build server's config.")
      return head(:unauthorized)
    end

    build = Build.find(params[:id])
    payload = JSON.parse(body) rescue {}

    # A build the author cancelled is finished, whatever the server decided a moment
    # later. Cancelling races a build that was already wrapping up, and the output of a
    # build nobody is waiting for must not be imported over the top of what is published.
    return head(:ok) if build.canceled?

    case payload["status"]
    when "success"
      build.mark!(:received_from_server, log: inline_log(payload))
      import_artifact(build, payload)
      fetch_full_log_later(build, payload)
    when "failed"
      # A failed build that still produced output. The server zips whatever landed in
      # output/ whatever the exit code was, and sends `artifact_url` whenever that zip
      # exists -- so its presence, not the status word, is what decides whether there is
      # anything to import. Imported the same way a success is, and flagged so the
      # dashboard, the drawer and the log page can warn that what an author is about to
      # preview (or publish) came out of a build that reported errors.
      if payload["artifact_url"].present?
        build.mark!(:received_from_server, log: inline_log(payload), completed_with_errors: true)
        import_artifact(build, payload)
        Rails.logger.warn("Build #{build.id} exited #{payload["exit_code"].inspect} on the build " \
                          "server but produced output -- importing it and flagging the build.")
      else
        build.mark!(:failed, log: inline_log(payload))
        Rails.logger.error("Build #{build.id} failed on build server: #{payload["log_tail"] || body}")
      end
      fetch_full_log_later(build, payload)
    else
      # Nothing recorded and nothing broadcast, so the row goes on saying Building: the
      # symptom of a status word drifting apart from the two this understands is a build
      # that finishes everywhere except on the author's dashboard. Diff against notify.py's
      # _build_payload if this ever shows up. BuildRecheckJob is what recovers the build.
      Rails.logger.warn("Build callback for build #{build.id} carried status " \
                        "#{payload["status"].inspect}, which is neither \"success\" nor " \
                        "\"failed\" -- nothing was recorded.")
    end

    head :ok
  end

  private

    # artifact_url from the build server is a path relative to itself (e.g.
    # "/builds/<id>/artifact"), not an absolute URL -- resolve it against the
    # configured host before handing it to the job.
    def import_artifact(build, payload)
      FullBuildArtifactJob.perform_later(build, FullBuildServer.url_for(payload["artifact_url"]))
    end

    # The build server never sends the whole log inline. Its payload carries `log_tail`
    # (the last CALLBACK_LOG_TAIL_CHARS characters, 4000 by default), a `log_truncated`
    # flag, and `log_url` for the rest -- see notify.py's _build_payload.
    #
    # This used to read payload["log"], a key the server does not send and never has, so
    # `.presence` fell through on every single build and every author saw the placeholder
    # instead of their log. If that symptom ever comes back, start by diffing these key
    # names against _build_payload.
    def inline_log(payload)
      payload["log_tail"].presence || NO_LOG
    end

    # ...and the remainder comes out of band, so a slow log endpoint cannot stall this
    # response long enough for the server to give up and retry the whole callback.
    def fetch_full_log_later(build, payload)
      return unless payload["log_truncated"] && payload["log_url"].present?

      FullBuildLogJob.perform_later(build, payload["log_url"])
    end

    def valid_signature?(body)
      secret = Rails.application.credentials.dig(:full_build, :webhook_secret).to_s
      return false if secret.empty?

      # The build server sends "sha256=<hexdigest>" (see notify.py's _sign),
      # not a bare hexdigest -- strip the algorithm prefix before comparing.
      provided = request.headers[SIGNATURE_HEADER].to_s.delete_prefix("sha256=")
      expected = OpenSSL::HMAC.hexdigest("SHA256", secret, body)
      ActiveSupport::SecurityUtils.secure_compare(provided, expected)
    end
end
