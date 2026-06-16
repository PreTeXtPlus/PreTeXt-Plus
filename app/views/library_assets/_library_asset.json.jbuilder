json.extract! library_asset, :id, :user_id, :kind, :file, :content, :description, :short_description, :created_at, :updated_at
json.file url_for(library_asset.file) if library_asset.file.present?
