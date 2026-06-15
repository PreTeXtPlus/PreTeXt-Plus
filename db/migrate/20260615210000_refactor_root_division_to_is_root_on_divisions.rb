class RefactorRootDivisionToIsRootOnDivisions < ActiveRecord::Migration[8.1]
  def change
    add_column :divisions, :is_root, :boolean, null: false, default: false

    reversible do |dir|
      dir.up do
        execute <<~SQL
          UPDATE divisions
          SET is_root = true
          FROM projects
          WHERE projects.root_division_id = divisions.id
        SQL
      end
    end

    remove_reference :projects, :root_division, type: :uuid, foreign_key: { to_table: :divisions }, null: true
  end
end
