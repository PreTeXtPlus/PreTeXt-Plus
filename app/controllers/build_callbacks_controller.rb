require "openssl"
require "uri"

# Receives async status callbacks from the full build server
# (pretext-plus-build-full). The server is not an authenticated user, so this
# endpoint skips login and CSRF and instead authenticates the request by
# verifying an HMAC-SHA256 signature (X-PreTeXt-Signature) over the raw body,
# using a secret shared with the build server (FULL_BUILD_WEBHOOK_SECRET).
class BuildCallbacksController < ApplicationController
  allow_unauthenticated_access only: :create
  skip_forgery_protection only: :create

  SIGNATURE_HEADER = "X-PreTeXt-Signature".freeze

  # POST /projects/:project_id/builds/:id/full_callback
  def create
    body = request.raw_post
    unless valid_signature?(body)
      Rails.logger.warn("Build callback for build #{params[:id]} rejected: invalid or missing #{SIGNATURE_HEADER} -- check FULL_BUILD_WEBHOOK_SECRET matches the build server's config.")
      return head(:unauthorized)
    end

    build = Build.find(params[:id])
    payload = JSON.parse(body) rescue {}

    case payload["status"]
    when "success"
      # artifact_url from the build server is a path relative to itself (e.g.
      # "/builds/<id>/artifact"), not an absolute URL -- resolve it against
      # FULL_BUILD_HOST before handing it to the job, same as BuildStatusChecker does.
      artifact_url = URI.join("https://#{Rails.app.creds.require(:full_build, :host)}", payload["artifact_url"]).to_s
      FullBuildArtifactJob.perform_later(build, artifact_url)
    when "failed"
      build.update_columns(status: Build.statuses[:failed], log: payload["log"])
      Rails.logger.error("Build #{build.id} failed on build server: #{payload["log"] || body}")
    end

    head :ok
  end

  private

    def valid_signature?(body)
      secret = Rails.app.creds.require(:full_build, :webhook_secret).to_s
      return false if secret.empty?

      # The build server sends "sha256=<hexdigest>" (see notify.py's _sign),
      # not a bare hexdigest -- strip the algorithm prefix before comparing.
      provided = request.headers[SIGNATURE_HEADER].to_s.delete_prefix("sha256=")
      expected = OpenSSL::HMAC.hexdigest("SHA256", secret, body)
      ActiveSupport::SecurityUtils.secure_compare(provided, expected)
    end
end
