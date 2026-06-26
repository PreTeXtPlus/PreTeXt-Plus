class LibraryAsset < ApplicationRecord
  belongs_to :user
  has_one_attached :file
  enum :kind, {
    file: 0,
    authored: 1
  }, suffix: true

  def url
    if file.present?
      # use 1.hour to avoid clock skew
      return file.url(expires_in: 1.hour)
    end
    "/image-not-found.svg"
  end
end
