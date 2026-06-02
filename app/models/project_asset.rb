class ProjectAsset < ApplicationRecord
  belongs_to :library_asset
  belongs_to :project
end
