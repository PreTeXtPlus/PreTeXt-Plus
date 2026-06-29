class AnnouncementsController < ApplicationController
  load_and_authorize_resource
  allow_unauthenticated_access only: %i[index show]

  def index
    @announcements = Announcement.published
    @announcements = @announcements.where(paid_subscribers_only: false) unless current_user&.subscribed? || current_user&.admin?
  end

  def show
  end
end
