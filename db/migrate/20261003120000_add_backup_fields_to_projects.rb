# frozen_string_literal: true

# Automatic backups (see ProjectBackup) are stored as Project rows of their own:
# a full_dup of the project at one moment, carrying its divisions, snippets and
# assets, which is exactly what restoring one needs. `backup_of_id` is both the
# flag that hides a row from everything else (Project's default scope) and the
# link back to the project it is a backup of; `backup_tier` names its slot in the
# rotation, of which a project holds at most one each.
class AddBackupFieldsToProjects < ActiveRecord::Migration[8.1]
  def change
    add_reference :projects, :backup_of, type: :uuid, foreign_key: { to_table: :projects }, index: false
    add_column :projects, :backup_tier, :integer
    add_column :projects, :backed_up_at, :datetime
    add_index :projects, [ :backup_of_id, :backup_tier ], unique: true
  end
end
