# Adds the timestamp that answers "when did the author last change something a build
# would consume?" -- source, docinfo or assets.
#
# `updated_at` cannot answer it: the editor saves through nested divisions_attributes,
# and because no attribute on the projects row itself changes, Rails never issues an
# UPDATE on the parent. (Which is also why "Last updated" on the projects index has been
# reporting the last rename rather than the last edit.)
#
# A separate column rather than fixing updated_at alone, because renaming a project,
# publishing an output or reordering targets all touch updated_at, and none of those
# should mark a built target out of date.
class AddSourceUpdatedAtToProjects < ActiveRecord::Migration[8.1]
  def change
    # The DB-level default covers rows created outside the model callbacks -- notably
    # fixtures, which insert directly and would otherwise violate NOT NULL.
    add_column :projects, :source_updated_at, :datetime,
               null: false, default: -> { "CURRENT_TIMESTAMP" }

    reversible do |dir|
      dir.up do
        # Best available truth for existing rows: the newest of the project itself and
        # anything it owns. Without this, every pre-existing project would look as though
        # it had been edited at migration time, marking every built target stale at once.
        execute <<~SQL
          UPDATE projects SET source_updated_at = GREATEST(
            projects.updated_at,
            COALESCE((SELECT MAX(updated_at) FROM divisions
                      WHERE divisions.project_id = projects.id), projects.updated_at),
            COALESCE((SELECT MAX(updated_at) FROM assets
                      WHERE assets.project_id = projects.id), projects.updated_at)
          )
        SQL
      end
    end
  end
end
