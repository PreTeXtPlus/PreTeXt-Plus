# frozen_string_literal: true

# Unify divisions, assets and snippets into one `contents` table, told apart by
# `kind`.
#
# All three were already the same thing in every way that matters -- a
# project-scoped record named by a `ref` that `<plus:* ref="..."/>` placeholders
# resolve against, in one namespace across all three -- and that shared
# namespace was enforced by each model querying the other two tables by hand.
# One table makes it one unique index.
#
# Rows keep their ids. Those ids are what a collaborative document keys its
# entries by and what an asset's file attachment points at, so preserving them
# is what lets both carry on unchanged; the attachment only needs its
# record_type (and, for the rename to a has_many_attached, its name) moved.
#
# The metadata columns a division now has -- title, division_type, attrs --
# arrive empty here, and are filled from each division's own source by
# SplitDivisionMetadataOutOfSources once the collaborative documents have been
# flushed into these rows (ProjectAndResetDocsForContentFields).
#
# The old tables are renamed, not dropped, as the rollback path; a later
# migration drops them once this has been running in production.
class CreateContents < ActiveRecord::Migration[8.1]
  DIVISION = 0
  SNIPPET = 1
  FILE_ASSET = 2
  AUTHORED_ASSET = 3

  LEGACY_TABLES = { divisions: :legacy_divisions, snippets: :legacy_snippets, assets: :legacy_assets }.freeze

  def up
    abort_on_ref_collisions!

    create_table :contents, id: :uuid do |t|
      t.references :project, null: false, foreign_key: true, type: :uuid, index: false
      t.integer :kind, null: false
      t.string :ref, null: false
      t.text :source
      t.integer :source_format, default: 0, null: false
      t.boolean :is_root, default: false, null: false
      # Text, not string: a title is markup in its division's own format.
      t.text :title
      t.string :division_type
      t.jsonb :attrs, default: {}, null: false
      t.string :short_description
      t.text :description
      t.timestamps
    end
    add_index :contents, [ :project_id, :ref ], unique: true
    add_index :contents, [ :project_id, :kind ]
    add_index :contents, :project_id, unique: true, where: "is_root", name: "index_contents_on_project_id_unique_root"
    add_check_constraint :contents, "NOT is_root OR kind = #{DIVISION}", name: "contents_root_is_a_division"

    execute <<~SQL
      INSERT INTO contents (id, project_id, kind, ref, source, source_format, is_root, created_at, updated_at)
      SELECT id, project_id, #{DIVISION}, ref, source, source_format, is_root, created_at, updated_at
      FROM divisions
    SQL
    execute <<~SQL
      INSERT INTO contents (id, project_id, kind, ref, source, source_format, created_at, updated_at)
      SELECT id, project_id, #{SNIPPET}, ref, source, source_format, created_at, updated_at
      FROM snippets
    SQL
    execute <<~SQL
      INSERT INTO contents (id, project_id, kind, ref, source, title, short_description, description, created_at, updated_at)
      SELECT id, project_id, CASE kind WHEN 0 THEN #{FILE_ASSET} ELSE #{AUTHORED_ASSET} END,
             ref, source, title, short_description, description, created_at, updated_at
      FROM assets
    SQL
    execute <<~SQL
      UPDATE active_storage_attachments
      SET record_type = 'Content', name = 'files'
      WHERE record_type = 'Asset' AND name = 'file'
    SQL

    # Off the foreign keys as well as out of the way: nothing deletes these rows
    # any more, so a key to projects would make every project undeletable.
    LEGACY_TABLES.each do |table, legacy|
      remove_foreign_key table, :projects
      rename_table table, legacy
    end
  end

  def down
    LEGACY_TABLES.each do |table, legacy|
      rename_table legacy, table
      add_foreign_key table, :projects
    end
    execute <<~SQL
      UPDATE active_storage_attachments
      SET record_type = 'Asset', name = 'file'
      WHERE record_type = 'Content' AND name = 'files'
    SQL
    drop_table :contents
  end

  private

  # A ref shared by two records of different kinds in one project was only ever
  # prevented by a hand-rolled check in each model, so a race could have let one
  # through; the unique index below would refuse it. Placeholders name records
  # by ref, so there is no rename this migration could choose that is not a
  # guess about which one the author meant -- stop, and say which.
  def abort_on_ref_collisions!
    rows = select_rows(<<~SQL)
      SELECT project_id, ref FROM (
        SELECT project_id, ref FROM divisions
        UNION ALL SELECT project_id, ref FROM snippets
        UNION ALL SELECT project_id, ref FROM assets
      ) refs
      GROUP BY project_id, ref HAVING count(*) > 1 OR ref IS NULL
    SQL
    return if rows.empty?

    raise "contents need unique, present refs per project; fix these first: " +
      rows.map { |project_id, ref| "#{project_id}:#{ref.inspect}" }.join(", ")
  end
end
