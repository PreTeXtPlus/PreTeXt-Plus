# The second denormalized pointer a target row needs.
#
# current_build answers "what do readers see?". latest_build answers "how did the most
# recent attempt go?" -- which is what the state pill reports, and the two are
# deliberately different whenever a rebuild fails over a published output.
#
# Without this, Target#state had to run `builds.exists?` and `builds.order.first` per
# target, so the projects index issued two extra queries for every output an author
# added. Like current_build_id, no foreign key: it would be circular, and
# Build#sync_target keeps it honest.
class AddLatestBuildToTargets < ActiveRecord::Migration[8.1]
  def change
    add_column :targets, :latest_build_id, :uuid

    reversible do |dir|
      dir.up do
        execute <<~SQL
          UPDATE targets SET latest_build_id = b.id
          FROM (
            SELECT DISTINCT ON (target_id) id, target_id
            FROM builds ORDER BY target_id, created_at DESC
          ) b
          WHERE b.target_id = targets.id
        SQL
      end
    end
  end
end
