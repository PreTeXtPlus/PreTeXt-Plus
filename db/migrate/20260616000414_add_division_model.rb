class AddDivisionModel < ActiveRecord::Migration[8.1]
  def change
    create_table :divisions, id: :uuid do |t|
      t.text :source
      t.integer :source_format, null: false, default: 0
      t.boolean :is_root, null: false, default: false
      t.references :project, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
    reversible do |dir|
      dir.up do
        execute <<~SQL
          INSERT INTO divisions (id, source, source_format, is_root, project_id, created_at, updated_at)
          SELECT gen_random_uuid(), source, source_format, TRUE, id, NOW(), NOW()
          FROM projects
        SQL
      end
      dir.down do
        Division.where(is_root: true).each do |d|
          d.project.update(source: d.source, source_format: d.source_format)
        end
      end
    end
    remove_column :projects, :source, :text
    remove_column :projects, :source_format, :integer, default: 0, null: false
  end
end
