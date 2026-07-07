json.extract! project, :id, :title, :pretext_source, :docinfo, :document_type, :use_common_docinfo, :common_docinfo
json.url project_url(project, format: :json)
json.divisions project.divisions do |division|
  json.partial! "divisions/division", division: division
end
json.assets project.assets do |asset|
  json.partial! "assets/asset", asset: asset
end
