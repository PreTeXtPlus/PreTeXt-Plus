json.extract! library_asset, :id, :file, :filename, :user_id, :created_at, :updated_at
json.url library_asset_url(library_asset, format: :json)
json.file url_for(library_asset.file)
