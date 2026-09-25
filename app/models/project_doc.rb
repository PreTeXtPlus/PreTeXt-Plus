# frozen_string_literal: true

# A project's collaborative Yjs document, as this app addresses it.
#
# The document itself lives in yrby's store (`Y::Document` plus its update
# tail); this is the thin layer that names it, seeds it, and records changes to
# it. The server integrates every update it is given -- it is a participant in
# the CRDT, not a relay passing opaque bytes between browsers -- which is what
# lets ProjectDocChannel answer a joining client's state vector with exactly
# the updates that client is missing.
module ProjectDoc
  # yrby addresses documents by one opaque string. Deliberately not the
  # polymorphic record binding the gem also offers: its `record_id` is a bigint
  # by default where projects have uuid primary keys, and the one caller that
  # does need to walk from a document back to a project reads the key instead
  # (see `project_id_from`).
  def self.key_for(project)
    "project/#{project.id}/doc"
  end

  # The inverse, for the one caller that starts from documents rather than from
  # a project: ProjectDocProjectionJob, which asks the store which documents
  # have been written to lately and has to get back to the projects they belong
  # to. Kept beside `key_for` so the shape of a key is stated once.
  #
  # nil for anything that is not one of ours -- yrby's store is not exclusively
  # this app's, and a key it does not recognise is not an error here.
  KEY_PATTERN = %r{\Aproject/(?<project_id>[0-9a-fA-F-]{36})/doc\z}

  def self.project_id_from(key)
    KEY_PATTERN.match(key.to_s)&.[](:project_id)
  end

  # Everything a joining client's handshake needs: the snapshot with the
  # uncompacted tail folded in. yrby serves the diff against the client's own
  # state vector from this, so being behind is something the server computes
  # rather than something the client has to infer.
  def self.load_state(key)
    Y::Document.load_state(key)
  end

  # Record one delta. The hot path: this runs inside `on_change` for every
  # keystroke in every collaborative session, before the update is acked or
  # relayed to anyone.
  #
  # Deliberately not `Y::Document.append`, for two reasons. It compacts inline
  # once the tail passes `compact_every`, which on a book-sized document is
  # ~90ms paid by whichever keystroke happens to be the 64th --
  # CompactProjectDocsJob does that off the hot path instead. And its `locate!`
  # selects the whole row, which on the same document means reading ~700KB of
  # snapshot per keystroke; only the id is needed here.
  def self.record(key, update)
    document_id = Y::Document.where(key: key).pick(:id) ||
                  Y::Document.create_or_find_by!(key: key).id
    Y::DocumentUpdate.create!(document_id: document_id, payload: update)
  end

  # Create the document from a client's seed, once. Two clients each seeding an
  # empty document and then syncing would duplicate every division's text --
  # the CRDT is right to treat two independent seeds as concurrent inserts --
  # so the unique index on `key` arbitrates and the loser joins instead.
  # Returns true if this caller's seed became the document.
  def self.seed(project, state)
    Y::Document.create!(key: key_for(project), state: state)
    true
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
    false
  end

  def self.seeded?(project)
    Y::Document.exists?(key: key_for(project))
  end

  # Drop the document and its tail. Called when the last collaboration is
  # removed: from then on the owner edits solo and the divisions are written
  # directly, so a retained document would only go stale. A later collaboration
  # seeds a fresh one from those divisions.
  def self.reset!(project)
    Y::Document.where(key: key_for(project)).destroy_all
  end
end
