class ApplicationController < ActionController::Base
  include ActiveStorage::SetCurrent
  before_action :authenticate_user!
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
    unless current_user&.admin
      redirect_to projects_path, alert: "You are not authorized" and return
    end
  end
end
