# frozen_string_literal: true

# A project's collaborative editing session, over the y-websocket sync protocol.
#
# The server holds the document. A joining client sends its state vector and is
# answered with exactly the updates it does not have; every update it makes is
# recorded here before it is acknowledged or relayed. That is the whole of the
# reliability story, and it is worth saying why it replaced a hand-written one.
#
# This channel used to be a relay: it stored opaque base64 and broadcast it, and
# no party could answer "what do you have that I don't?" -- so each client had to
# infer it, from sequence numbers, from row ids, from whether Yjs reported
# anything pending. Every one of those inferences is unsound in some case, and a
# Yjs update that goes missing does not degrade gracefully: it strands every
# later insert from that peer, unapplied, while their deletes keep applying, so
# a document silently reads as though someone deleted their work and never
# retyped it. Here the diff is computed by the side that holds the data, so
# there is nothing to infer.
#
# Awareness (cursors, names) rides the same channel and is relayed without being
# stored, as presence should be.
class ProjectDocChannel < ApplicationCable::Channel
  include Y::ActionCable

  # Rebuild the document from durable storage. nil means nobody has seeded it
  # yet, which is a legitimate brand-new document rather than an error.
  on_load { |key| ProjectDoc.load_state(key) }

  # Record every delta before it is acked or relayed. Raising here rejects the
  # change: the client holds it and retries, which is the right way round --
  # ActionCable's `perform` reports that a socket took the bytes, never that
  # anyone stored them.
  on_change { |key, update| ProjectDoc.record(key, update) }

  # A causal gap in the stored document: an update arrived whose predecessor
  # never did. yrby parks it and heals it when the missing update turns up (a
  # peer's retransmit, or the next join handshake), so this is a measurement
  # rather than an alarm -- but the rate is the only way to see whether the
  # relay is still losing messages, and nothing else can see it at all.
  on_gap { |key| report_gap(key) }

  def subscribed
    project = Project.find_by(id: params[:project_id])
    ability = Ability.new(current_user)
    if project.nil? || ability.cannot?(:update, project)
      reject
      return
    end
    @project = project
    sync_subscribed(ProjectDoc.key_for(project))
  end

  def receive(data)
    sync_receive(data)
  end

  private

  # Identify the connection in yrby's dropped-frame logs, which otherwise say
  # only that a frame was too big or unparseable.
  def sync_log_context
    "project=#{@project&.id} user=#{current_user&.id}"
  end

  def report_gap(key)
    context = { key: key, project_id: @project&.id, user_id: current_user&.id }
    Honeybadger.notify(
      "Collaborative editing: document holds a causal gap",
      error_class: "Collab::DocumentGap",
      context: context
    )
    Rails.logger.warn("[collab-incident] #{context.merge(kind: "document_gap").to_json}")
  end
end
