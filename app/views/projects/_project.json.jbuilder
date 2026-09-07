json.extract! project, :id, :title, :pretext_source, :docinfo, :language, :use_common_docinfo, :common_docinfo
# The *structural* document type, not the column: an author who switched this
# document between article and book did it by rewriting the root division's own
# source, which never reaches `document_type` (see
# ProjectsController#project_params). railsToEditorState turns this into the
# editor's `projectType`, and for a latex/markdown root that value is what
# railsDivisionToEditor hands back as the root's type -- so the stale column
# here showed such a document as the kind it was created as, whatever its
# source now says.
json.document_type project.structural_document_type
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
json.snippets project.snippets do |snippet|
  json.partial! "snippets/snippet", snippet: snippet
end
