class AnnouncementsController < ApplicationController
  load_and_authorize_resource
  allow_unauthenticated_access only: %i[index show unsubscribe]

  def index
    @announcements = Announcement.published
    @announcements = @announcements.where(paid_subscribers_only: false) unless current_user&.subscribed? || current_user&.admin?
  end

  def show
  end

  def unsubscribe
    @user = User.find_by(announcement_unsubscribe_token: params[:token])
    if @user
      @user.update!(announcement_emails: false)
      @unsubscribed = true
    else
      @unsubscribed = false
    end
  end

  def subscribe
    current_user.update!(announcement_emails: true)
    redirect_to edit_user_path(current_user), notice: "You are now subscribed to announcements."
  end
end
