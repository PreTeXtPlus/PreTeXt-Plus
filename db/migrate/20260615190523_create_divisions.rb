class CreateDivisions < ActiveRecord::Migration[8.1]
  def change
    create_table :divisions, id: :uuid do |t|
      t.text :source
      t.integer :source_format, null: false, default: 0
      t.references :project, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end

    add_reference :projects, :root_division, type: :uuid, foreign_key: { to_table: :divisions }, null: true

    reversible do |dir|
      dir.up do
        execute <<~SQL
          INSERT INTO divisions (id, source, source_format, project_id, created_at, updated_at)
          SELECT gen_random_uuid(), source, source_format, id, NOW(), NOW()
          FROM projects
        SQL

        execute <<~SQL
          UPDATE projects
          SET root_division_id = divisions.id
          FROM divisions
          WHERE divisions.project_id = projects.id
        SQL

        change_column_null :projects, :root_division_id, false
      end
    end

    remove_column :projects, :source, :text
    remove_column :projects, :source_format, :integer, default: 0, null: false
  end
end
