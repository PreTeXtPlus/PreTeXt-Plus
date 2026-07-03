class Build < ApplicationRecord
  belongs_to :project
  has_one_attached :zip
  has_many :build_files, dependent: :destroy

  enum :status, { pending: 0, in_progress: 1, success: 2, failed: 3 }, default: :pending, validate: true
end
