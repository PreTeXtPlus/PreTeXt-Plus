json.extract! project, :id, :title, :pretext_source, :docinfo, :document_type, :use_common_docinfo, :common_docinfo
json.url project_url(project, format: :json)
json.divisions project.divisions do |division|
  json.partial! "divisions/division", division: division
end
json.project_assets project.project_assets do |asset|
  json.partial! "project_assets/project_asset", project_asset: asset
end
