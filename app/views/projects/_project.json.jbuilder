json.extract! project, :id, :title, :source, :source_format, :document_type, :created_at, :updated_at
json.url project_url(project, format: :json)
json.has_source_elements project.source_elements.any?
