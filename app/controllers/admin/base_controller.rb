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
    result = "Admin" if user.admin?
    result = "Subscribed" if result.blank? && user.subscribed?
    result = "Standard" if result.blank?
    result += " (Unconfirmed)" unless user.confirmed?
    result
  end
end
