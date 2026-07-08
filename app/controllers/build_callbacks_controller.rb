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

  # POST /projects/:project_id/builds/:id/full_callback
  def create
    body = request.raw_post
    return head(:unauthorized) unless valid_signature?(body)

    build = Build.find(params[:id])
    payload = JSON.parse(body) rescue {}

    case payload["status"]
    when "success"
      FullBuildArtifactJob.perform_later(build, payload["artifact_url"])
    when "failed"
      build.update_column(:status, Build.statuses[:failed])
      Rails.logger.error("Build #{build.id} failed on build server: #{payload["log"] || body}")
    end

    head :ok
  end

  private

    def valid_signature?(body)
      secret = ENV["FULL_BUILD_WEBHOOK_SECRET"].to_s
      return false if secret.empty?

      provided = request.headers[SIGNATURE_HEADER].to_s
      expected = OpenSSL::HMAC.hexdigest("SHA256", secret, body)
      ActiveSupport::SecurityUtils.secure_compare(provided, expected)
    end
end
