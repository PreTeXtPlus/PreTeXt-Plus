class ApplicationController < ActionController::Base
  include Authentication
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  private

  def allow_iframe
    response.headers.except! "X-Frame-Options"
  end

  def require_admin
    require_authentication
    unless @current_user.admin
      redirect_to projects_path, alert: "You are not authorized" and return
    end
  end
end
