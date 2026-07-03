class ApplicationController < ActionController::Base
  include ActiveStorage::SetCurrent
  before_action :authenticate_user!

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
    redirect_to url, allow_other_host: true
  end

  private

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
end
