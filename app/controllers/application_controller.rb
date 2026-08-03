class ApplicationController < ActionController::Base
  include ActiveStorage::SetCurrent
  before_action :authenticate_user!
  around_action :set_time_zone

  rescue_from CanCan::AccessDenied do |exception|
    if request.format.json?
      render json: { errors: [ exception.message ] }, status: :forbidden
    else
      redirect_to projects_path, alert: exception.message
    end
  end

  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  def self.allow_unauthenticated_access(**options)
    skip_before_action :authenticate_user!, **options
  end

  def self.require_unauthenticated_access(**options)
    skip_before_action :authenticate_user!, **options
    before_action :redirect_authenticated_user, **options
  end

  def after_sign_in_path_for(resource)
    stored_location_for(resource) || projects_path
  end

  def after_sign_out_path_for(_resource_or_scope)
    new_user_session_path
  end

  def redirect_to_cdn_url(url)
    response.headers["Cache-Control"] = "no-store, private"
    redirect_to cdn_asset_url(url), allow_other_host: true
  end

  private

  # Swaps a DigitalOcean Spaces origin host for the Spaces CDN's custom
  # subdomain, leaving path and query (which carries the presigned signature)
  # untouched -- DO's CDN forwards presigned requests to the origin and
  # validates them there, as long as the URL is virtual-hosted-style (which
  # storage.yml already produces, since force_path_style is never set). A
  # no-op when spaces_cdn_host isn't configured, or the URL isn't a Spaces
  # origin URL (e.g. the local "/icon.svg" and "/image-not-found.svg"
  # fallback paths).
  def cdn_asset_url(url)
    cdn_host = Rails.application.config.x.spaces_cdn_host.presence
    return url unless cdn_host

    uri = URI.parse(url)
    return url unless uri.host&.end_with?(".digitaloceanspaces.com")

    uri.host = cdn_host
    uri.to_s
  end

  def authenticated?
    user_signed_in?
  end

  def redirect_authenticated_user
    redirect_to projects_path if user_signed_in?
  end

  def allow_iframe
    response.headers.except! "X-Frame-Options"
  end

  def require_admin
    authorize! :manage, :admin
  end

  # Reads the "tz" cookie set client-side (see app/javascript/application.js) so
  # local_time_tag can server-render already-localized times. Time.zone is a
  # thread-global, not request-scoped, so Time.use_zone sets it for this request
  # only and restores it afterward (threads are reused across requests).
  def set_time_zone(&block)
    zone = ActiveSupport::TimeZone[cookies[:tz]] if cookies[:tz]
    Time.use_zone(zone || Time.zone, &block)
  end
end
