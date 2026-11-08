# What the last ProjectDocProjection of a project's collaborative document had
# to leave out, and when it last ran. Empty issues mean every record in the
# document reached its row; anything listed is a record the editor shows but
# the rows do not hold, which is what the editor banner, the build log and the
# repair task read.
class AddProjectionOutcomeToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :projection_issues, :jsonb, default: [], null: false
    add_column :projects, :projection_checked_at, :datetime
  end
end
