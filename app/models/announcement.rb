class Announcement < ApplicationRecord
  validates :title, presence: true
  validates :body, presence: true

  scope :published, -> { where.not(published_at: nil).order(published_at: :desc) }

  # The one announcement the marketing homepage banners, or nil. Paid-subscriber-only
  # announcements never qualify: the homepage is public and Ability denies those to
  # anyone unsubscribed, so a banner for one would link most visitors to a 403.
  # Several may be flagged at once (admins forget to clear the old one) -- the newest
  # wins rather than showing a stack.
  def self.homepage_banner
    published.where(show_on_homepage: true, paid_subscribers_only: false).first
  end

  def published?
    published_at.present?
  end

  def publish!
    raise "Cannot publish a draft announcement" if draft?

    update!(published_at: Time.current)
    BroadcastAnnouncementJob.perform_later(self)
  end
end
