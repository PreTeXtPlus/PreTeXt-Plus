class LibraryAsset < ApplicationRecord
  belongs_to :user
  has_one_attached :file
  validates :filename, format: /[\w,\s-]+\.[A-Za-z]+/, presence: true, uniqueness: { scope: :user_id }
end
