class LibraryAsset < ApplicationRecord
  belongs_to :user
  has_one_attached :file
  enum :kind, {
    file: 0,
    doenet: 1
  }, suffix: true
end
