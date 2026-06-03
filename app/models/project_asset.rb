class ProjectAsset < ApplicationRecord
  belongs_to :library_asset
  belongs_to :project
  validates_uniqueness_of :library_asset, scope: :project
  validates :ref, format: /\A[a-zA-z\_][a-zA-Z0-9\-\_]*\z/, presence: true, uniqueness: { scope: :project }
end
