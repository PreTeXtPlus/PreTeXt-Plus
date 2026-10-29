# `source_format`: "pretext" for most assets; a generator's id ("prefigure") for a
# generated asset, whose `source` is then that generator's input, not PreTeXt.
json.extract! asset, :id, :project_id, :ref, :kind, :source_format, :source, :description, :short_description, :title, :created_at, :updated_at
if asset.file_attached?
  extension = asset.file_extension
  # `file`: the public, project+ref-scoped redirect to the asset's current
  # file location -- a real, directly fetchable URL, used both as the
  # editor's own thumbnail `<img src>` and by the client when it needs to
  # fetch the bytes.
  # `extension`: lets the client build the *bare* `<ref>.<ext>` fragment it
  # writes into the assembled PreTeXt as an image's `source` -- the build
  # server treats that as a plain external-asset filename and prepends
  # `external/` itself, so embedding a full URL there double-prefixes (see
  # the comments in projects_controller.rb / project.rb).
  json.path content_file_project_path(asset.project, ref: asset.ref, format: extension)
  json.extension extension
  json.content_type asset.file_content_type
  # `thumbnail_path`: a small resized preview redirect, distinct from `path`
  # above -- used for the asset list's `<img src>` (editor's asset manager,
  # project dashboard) rather than the full file. Only set when a preview is
  # actually possible; see Content::AttachedFiles#thumbnail_url.
  if asset.thumbnailable?
    json.thumbnail_path content_thumbnail_project_path(asset.project, ref: asset.ref, format: extension)
  end
end
if asset.generated_asset?
  # The digest the stored picture was built from. The editor recomputes currency
  # itself from the live source (it has text the server has not been sent yet);
  # `preview_current` is the server's reading of the saved row, for anything that
  # only sees JSON.
  json.preview_input_digest asset.preview_input_digest
  json.preview_current asset.preview_current?
end
