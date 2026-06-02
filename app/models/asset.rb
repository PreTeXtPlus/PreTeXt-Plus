class Asset < ApplicationRecord
  has_one_attached :file
  belongs_to :user
  has_many :project_assets
  has_many :projects, through: :project_assets
  validates :filename, uniqueness: { scope: :user, message: "already has an asset with that filename" }
end
