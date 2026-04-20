class Admin::BaseController < ApplicationController
  before_action :require_admin
  helper_method :projects_count_for, :last_session_at_for, :access_label_for

  private

  def projects_count_for(user)
    user.attributes["projects_count"]&.to_i || user.projects.size
  end

  def last_session_at_for(user)
    user.attributes["last_session_at"] || user.sessions.maximum(:created_at)
  end

  def access_label_for(user)
    return "Admin" if user.admin?
    return "Subscribed" if user.subscribed?
    return "Invited" if @invited_user_lookup&.[](user.id)
    return "Requested access" if @requested_user_lookup&.[](user.id)

    "Unverified"
  end
end
