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
  # The development cable adapter is postgresql, whose LISTEN/NOTIFY transport caps one
  # message at 8000 bytes and raises inside the broadcast where no one watching the
  # browser will see it (see config/cable.yml). A Yjs update is normally tens of bytes,
  # but a paste or a whole-division rewrite is not, so past this size the update is
  # *announced* rather than sent: it is already in the append-only log, and clients pull
  # it over HTTP using the same catch-up path they use after a reconnect. Well under
  # 8000 to leave room for the JSON and ActionCable envelopes around it.
  MAX_BROADCAST_BYTES = 6_000

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

    if payload.bytesize > MAX_BROADCAST_BYTES
      self.class.broadcast_to(@project, {
        type: "resync",
        id: update.id,
        sender: data["sender"]
      })
    else
      self.class.broadcast_to(@project, {
        type: "update",
        id: update.id,
        payload: payload,
        sender: data["sender"]
      })
    end
  end

  def awareness(data)
    payload = data["payload"].to_s
    return if payload.blank?
    # Presence is ephemeral and unpersisted, so there is nothing to fetch and no point
    # raising: an oversized update is dropped and the sender's next heartbeat carries
    # the same state again.
    return if payload.bytesize > MAX_BROADCAST_BYTES

    self.class.broadcast_to(@project, {
      type: "awareness",
      payload: payload,
      sender: data["sender"]
    })
  end
end
