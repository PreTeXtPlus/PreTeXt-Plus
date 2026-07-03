json.extract! library_asset, :id, :user_id, :kind, :source, :description, :short_description, :title, :created_at, :updated_at
if library_asset.file.attached?
  extension = library_asset.file.filename.extension_without_delimiter.presence
  # `file`: owner-only redirect, used for the editor's own thumbnails when
  # browsing the full cross-project library -- a real, directly fetchable URL.
  # `extension`: lets the client build the *bare* `<ref>.<ext>` fragment it
  # writes into the assembled PreTeXt as an image's `source` once the asset has
  # a project-scoped ref -- the build server treats that as a plain
  # external-asset filename and prepends `external/` itself, so embedding a
  # full URL there double-prefixes (see the <base> comments in
  # projects_controller.rb / project.rb).
  json.file library_asset_file_path(library_asset, format: extension)
  json.extension extension
end
