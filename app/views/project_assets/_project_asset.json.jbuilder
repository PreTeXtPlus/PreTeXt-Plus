json.extract! project_asset, :id, :project_id, :ref, :created_at, :updated_at
json.library_asset do
  json.partial! "library_assets/library_asset", library_asset: project_asset.library_asset
end
json.url project_asset.url
