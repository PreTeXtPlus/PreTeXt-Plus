class ProjectAsset < ApplicationRecord
  belongs_to :library_asset
  belongs_to :project
  validates_uniqueness_of :library_asset, scope: :project
end
