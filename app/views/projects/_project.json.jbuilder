json.extract! project, :id, :title, :pretext_source, :docinfo, :document_type, :language, :use_common_docinfo, :common_docinfo
json.url project_url(project, format: :json)
# Real-time collaboration is on whenever the project has collaborators (or
# pending invites); the editor then joins the shared Yjs doc instead of
# editing purely locally. `editor_user` is who to show on remote cursors.
json.collaborative project.collaborative?
if current_user
  json.editor_user do
    json.id current_user.id
    json.name current_user.name.presence || current_user.email
  end
end
json.divisions project.divisions do |division|
  json.partial! "divisions/division", division: division
end
json.assets project.assets do |asset|
  json.partial! "assets/asset", asset: asset
end
