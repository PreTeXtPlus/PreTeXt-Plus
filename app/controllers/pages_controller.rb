class PagesController < ApplicationController
  allow_unauthenticated_access
  def home
    @start_writing_path = tryit_path
    if current_user.present?
      @start_writing_path = projects_path
    end
    @subscription_types = SubscriptionType.order(:order)
    @homepage_announcement = Announcement.homepage_banner
    @next_workshop = Workshop.next_upcoming
    render layout: false
  end
end
