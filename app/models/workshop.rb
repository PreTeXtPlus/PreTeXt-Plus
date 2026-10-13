class Workshop < ApplicationRecord
  validates :title, :start_time, :link, presence: true
  # The link is rendered as an href on public pages, so only web URLs are accepted --
  # never javascript: or data: URIs.
  validates :link, format: { with: URI::DEFAULT_PARSER.make_regexp(%w[http https]), allow_blank: true }

  scope :upcoming, -> { where(start_time: Time.current..).order(:start_time) }
  scope :past, -> { where(start_time: ...Time.current).order(start_time: :desc) }

  # The workshop the marketing homepage banners, or nil.
  def self.next_upcoming
    upcoming.first
  end

  def upcoming?
    start_time >= Time.current
  end
end
