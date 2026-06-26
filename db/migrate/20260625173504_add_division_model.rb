class AddDivisionModel < ActiveRecord::Migration[8.1]
  def change
    create_table :divisions, id: :uuid do |t|
      t.text :source
      t.string :ref
      t.integer :source_format, null: false, default: 0
      t.boolean :is_root, null: false, default: false
      t.references :project, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
    reversible do |dir|
      dir.up do
        execute <<~SQL
          INSERT INTO divisions (id, source, source_format, is_root, ref, project_id, created_at, updated_at)
          SELECT gen_random_uuid(), source, source_format, TRUE, 'document', id, NOW(), NOW()
          FROM projects
        SQL
      end
      dir.down do
        execute <<~SQL
          UPDATE projects
          SET source = divisions.source, source_format = divisions.source_format
          FROM divisions
          WHERE divisions.project_id = projects.id AND divisions.is_root = TRUE
        SQL
      end
    end
    remove_column :projects, :source, :text
    remove_column :projects, :source_format, :integer, default: 0, null: false
  end
end
