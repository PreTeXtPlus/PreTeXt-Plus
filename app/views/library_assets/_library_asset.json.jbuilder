json.extract! library_asset, :id, :user_id, :type, :file, :content, :description, :short_description, :created_at, :updated_at
json.url library_asset_url(library_asset, format: :json)
json.file url_for(library_asset.file)
