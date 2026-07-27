# Live relay for a project's collaborative editing session. Two message
# kinds, both opaque base64 payloads:
#
# * `doc_update`  -- a Yjs document update. Persisted to the append-only log
#   (so clients joining or reconnecting can catch up via
#   ProjectDocsController#show) and then broadcast.
# * `awareness`   -- ephemeral presence (cursors, names). Broadcast only.
#
# Every client subscribes with a random per-tab `sender` id and ignores its
# own broadcasts; Yjs updates are idempotent anyway, so a missed filter is
# harmless.
class ProjectDocChannel < ApplicationCable::Channel
  def subscribed
    project = Project.find_by(id: params[:project_id])
    ability = Ability.new(current_user)
    if project.nil? || ability.cannot?(:update, project)
      reject
      return
    end
    @project = project
    stream_for project
  end

  def doc_update(data)
    payload = data["payload"].to_s
    return if payload.blank?

    update = ProjectDocUpdate.create!(
      project: @project,
      payload: Base64.strict_decode64(payload)
    )
    self.class.broadcast_to(@project, {
      type: "update",
      id: update.id,
      payload: payload,
      sender: data["sender"]
    })
  end

  def awareness(data)
    payload = data["payload"].to_s
    return if payload.blank?

    self.class.broadcast_to(@project, {
      type: "awareness",
      payload: payload,
      sender: data["sender"]
    })
  end
end
