class Admin::BaseController < ApplicationController
  before_action :require_admin
  helper_method :projects_count_for, :last_sign_in_for, :access_label_for

  private

  def projects_count_for(user)
    user.attributes["projects_count"]&.to_i || user.projects.size
  end

  def last_sign_in_for(user)
    user.attributes["last_sign_in_at"] || user.last_sign_in_at
  end

  def access_label_for(user)
    return "Admin" if user.admin?
    return "Subscribed" if user.subscribed?
    return "Invited" if @invited_user_lookup&.[](user.id)
    return "Requested access" if @requested_user_lookup&.[](user.id)

    "Unverified"
  end
end
