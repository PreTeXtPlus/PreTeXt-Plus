class MaintenanceWindow < ApplicationRecord
  # How far ahead of a window every page starts warning about it.
  WARNING_PERIOD = 48.hours

  validates :starts_at, presence: true

  scope :upcoming, -> { where(starts_at: Time.current..).order(:starts_at) }
  scope :past, -> { where(starts_at: ...Time.current).order(starts_at: :desc) }

  # The window the site-wide banner warns about, or nil: the soonest one starting
  # within WARNING_PERIOD.
  def self.imminent
    upcoming.where(starts_at: ..WARNING_PERIOD.from_now).first
  end

  def upcoming?
    starts_at >= Time.current
  end
end
