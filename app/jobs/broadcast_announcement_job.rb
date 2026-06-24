class BroadcastAnnouncementJob < ApplicationJob
  queue_as :default

  def perform(announcement)
    User.where(announcement_emails: true).where.not(confirmed_at: nil).find_each do |user|
      AnnouncementsMailer.announcement(user, announcement).deliver_later
    end
  end
end
