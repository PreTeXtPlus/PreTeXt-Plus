class BuildFile < ApplicationRecord
  belongs_to :build
  has_one_attached :blob
  validates :relative_path, presence: true, uniqueness: { scope: :build_id }
end
