class ProjectAsset < ApplicationRecord
  belongs_to :asset
  belongs_to :project
end
