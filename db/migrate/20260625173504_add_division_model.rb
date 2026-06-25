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
        Division.where(is_root: true).each do |d|
          # Division#source_format is enum-cast to a string ("latex"); Project's
          # source_format is a plain integer column with no enum, so it must be
          # mapped back through Division.source_formats or it silently casts to 0.
          d.project.update(source: d.source, source_format: Division.source_formats[d.source_format])
        end
      end
    end
    remove_column :projects, :source, :text
    remove_column :projects, :source_format, :integer, default: 0, null: false
  end
end
