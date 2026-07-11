class Announcement < ApplicationRecord
  validates :title, presence: true
  validates :body, presence: true

  scope :published, -> { where.not(published_at: nil).order(published_at: :desc) }

  def published?
    published_at.present?
  end

  def publish!
    raise "Cannot publish a draft announcement" if draft?

    update!(published_at: Time.current)
    BroadcastAnnouncementJob.perform_later(self)
  end
end
