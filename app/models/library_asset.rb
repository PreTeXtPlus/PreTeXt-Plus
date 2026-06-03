class LibraryAsset < ApplicationRecord
  belongs_to :user
  has_one_attached :file
  enum :kind, {
    file: 0,
    doenet: 1
  }, suffix: true

  def url
    if file.present?
      return file.url
    end
    "/image-not-found.svg"
  end
end
