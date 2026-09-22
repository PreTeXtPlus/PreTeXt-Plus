# frozen_string_literal: true

# Hand the collaborative document over to the server-side CRDT store.
#
# `project_docs` / `project_doc_updates` existed because the server could not
# read a Yjs update: it kept the last snapshot a browser sent plus the raw log
# since, and browsers decided what the log meant. yrby's store replaces both,
# and the server now integrates every update itself.
#
# Each project's snapshot and its whole update tail are merged here into one
# `y_documents.state`, which is what the old compaction was trying to produce.
# Doing it in the migration means no session starts out with a tail to fold,
# and no row survives whose meaning depended on the client protocol.
class MoveProjectDocsToYDocuments < ActiveRecord::Migration[8.1]
  def up
    say_with_time "merging project_docs into y_documents" do
      migrated = 0
      each_legacy_doc do |project_id, snapshot, payloads|
        state = merged_state(snapshot, payloads)
        next if state.nil?

        connection.exec_insert(<<~SQL, "y_documents insert", [ key_for(project_id), state ])
          INSERT INTO y_documents (key, state, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (key) DO NOTHING
        SQL
        migrated += 1
      end
      migrated
    end

    drop_table :project_doc_updates
    drop_table :project_docs
  end

  # Deliberately one-way. Going back would mean writing a snapshot that the
  # browser-side protocol could still compact, and the client that understood
  # that protocol is gone in the same change.
  def down
    raise ActiveRecord::IrreversibleMigration
  end

  private

  def each_legacy_doc
    connection.select_rows("SELECT project_id, snapshot FROM project_docs").each do |project_id, snapshot|
      payloads = connection.select_values(
        "SELECT payload FROM project_doc_updates WHERE project_id = #{connection.quote(project_id)} ORDER BY id"
      )
      yield project_id, snapshot, payloads
    end
  end

  # Fold the snapshot and every appended update into one state. A payload that
  # will not integrate is skipped rather than fatal: it is an update whose
  # causal predecessor the old relay lost, and it has been invisible in every
  # client's document all along -- carrying it into the new store would freeze
  # that gap into the state every future session starts from.
  def merged_state(snapshot, payloads)
    require "y"
    doc = Y::Doc.new
    doc.apply_update(unescape(snapshot)) if snapshot
    payloads.each do |payload|
      doc.apply_update(unescape(payload))
    rescue Y::Error => e
      say "skipping an unintegrable update: #{e.message}", true
    end
    doc.compacted_state_update
  rescue Y::Error => e
    say "skipping a project whose snapshot will not load: #{e.message}", true
    nil
  end

  # select_rows hands back bytea as the driver presents it; normalise to binary.
  def unescape(value)
    return value if value.nil?

    bytes = value.is_a?(String) ? value : value.to_s
    bytes.start_with?("\\x") ? [ bytes[2..] ].pack("H*") : bytes.b
  end

  def key_for(project_id)
    "project/#{project_id}/doc"
  end
end
