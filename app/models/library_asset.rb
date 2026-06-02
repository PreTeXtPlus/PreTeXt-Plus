class LibraryAsset < ApplicationRecord
  belongs_to :user
  has_one_attached :file
  validates :filename, format: /\A[a-zA-Z0-9\-\_]+\.[a-zA-Z0-9]+\z/, presence: true, uniqueness: { scope: :user_id }
end
