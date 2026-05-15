class BuildProjectJob < ApplicationJob
  queue_as :default

  def perform(project_id)
    project = Project.find(project_id)

    project.update_columns(
      build_status: "running",
      last_build_started_at: Time.current,
      last_build_error: nil
    )

    result = BuildServerClient.new.build_artifacts(source: project.full_pretext_source, title: project.title)
    html = result[:html]
    manifest = result[:manifest]
    files = result[:files]

    persist_artifacts!(project, files)

    project.update_columns(
      build_status: "succeeded",
      html_source: html,
      artifact_prefix: "projects/#{project.id}/builds/#{manifest['build_id']}",
      artifact_manifest: manifest.except("inline_files"),
      last_build_finished_at: Time.current,
      last_build_error: nil
    )
  rescue StandardError => e
    project&.update_columns(
      build_status: "failed",
      artifact_prefix: nil,
      artifact_manifest: {},
      last_build_finished_at: Time.current,
      last_build_error: e.message
    )
    raise
  end

  private

  def persist_artifacts!(project, files)
    project.build_artifacts.purge

    files.each do |path, file_data|
      content = file_data[:content].to_s
      content_type = file_data[:content_type].presence || "application/octet-stream"
      filename = path.to_s.tr("/", "__")

      project.build_artifacts.attach(
        io: StringIO.new(content),
        filename: filename,
        content_type: content_type,
        metadata: { "artifact_path" => path.to_s }
      )
    end
  end
end