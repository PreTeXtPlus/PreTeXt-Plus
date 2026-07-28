class CreateProjectDocs < ActiveRecord::Migration[8.1]
  def change
    # One row per project that has an active collaborative document. The row's
    # existence is the "seeded" flag: creation is the compare-and-set that
    # ensures exactly one client ever seeds a doc (see ProjectDocsController).
    create_table :project_docs, id: :uuid do |t|
      t.references :project, type: :uuid, null: false, foreign_key: true, index: { unique: true }
      # The last compacted Yjs document state (opaque binary; Rails never
      # parses it). Merging this with any project_doc_updates rows yields the
      # current document.
      t.binary :snapshot
      t.timestamps
    end

    # Append-only log of Yjs updates since the last compaction. Needs an
    # *ordered* primary key -- compaction deletes "everything up to id N" --
    # so this table deliberately uses a bigserial id, unlike the app's uuid
    # convention.
    create_table :project_doc_updates, id: :bigint do |t|
      t.references :project, type: :uuid, null: false, foreign_key: true
      t.binary :payload, null: false
      t.datetime :created_at, null: false
    end
  end
end
