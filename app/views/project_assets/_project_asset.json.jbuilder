json.extract! project_asset, :id, :library_asset_id, :project_id, :ref, :created_at, :updated_at
# json.partial! "library_assets/library_asset", library_asset: project_asset.library_asset
json.url project_asset_url(project_asset.project, project_asset, format: :json)
