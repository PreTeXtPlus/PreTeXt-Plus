# A target is a named output configuration -- the persistent thing an author manages
# ("my PDF"), as opposed to a Build, which is one attempt at producing it. Mirrors the
# <targets> list in a PreTeXt-CLI project.ptx: names are unique within a project, and
# several targets may share a format (a "student" and an "instructor" html, say).
#
# Every existing project gets one `web` target matching the hardcoded
# ProjectArchiveBuilder::TARGET, and adopts that project's existing builds, so nothing
# user-facing changes when this runs.
class CreateTargets < ActiveRecord::Migration[8.1]
  def change
    create_table :targets, id: :uuid do |t|
      t.references :project, null: false, foreign_key: true, type: :uuid
      t.string   :name, null: false                    # goes verbatim into project.ptx
      t.string   :label                                # human-facing; nil -> derived
      t.integer  :output_format, null: false, default: 0
      t.boolean  :published, null: false, default: false
      t.integer  :position, null: false, default: 0

      # Denormalized pointers to the latest *successful* build -- what a reader sees.
      # Kept on the row so the projects index can render every target's state in one
      # query instead of one per target. Deliberately no foreign key: it would be
      # circular (targets.current_build_id -> builds.id -> targets.id) and would fight
      # dependent: :destroy. Build#release_from_target keeps it honest instead.
      t.datetime :last_built_at
      t.uuid     :current_build_id

      t.timestamps

      t.index [ :project_id, :name ], unique: true
    end

    add_reference :builds, :target, foreign_key: true, type: :uuid

    reversible do |dir|
      dir.up do
        execute <<~SQL
          INSERT INTO targets
            (id, project_id, name, label, output_format, published, position, created_at, updated_at)
          SELECT gen_random_uuid(), id, 'web', 'Website', 0, FALSE, 0, NOW(), NOW()
          FROM projects
        SQL

        execute <<~SQL
          UPDATE builds SET target_id = targets.id
          FROM targets WHERE targets.project_id = builds.project_id
        SQL

        # status = 2 is Build.statuses[:success].
        execute <<~SQL
          UPDATE targets SET current_build_id = b.id, last_built_at = b.created_at
          FROM (
            SELECT DISTINCT ON (target_id) id, target_id, created_at
            FROM builds WHERE status = 2
            ORDER BY target_id, created_at DESC
          ) b
          WHERE b.target_id = targets.id
        SQL
      end
    end

    change_column_null :builds, :target_id, false
  end
end
