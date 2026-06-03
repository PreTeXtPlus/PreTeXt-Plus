class LibraryAsset < ApplicationRecord
  belongs_to :user
  has_one_attached :file
  enum :type, {
    file: 0,
    doenet: 1
  }, suffix: true
end
