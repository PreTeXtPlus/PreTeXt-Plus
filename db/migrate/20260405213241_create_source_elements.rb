class CreateSourceElements < ActiveRecord::Migration[8.1]
  def change
    create_table :source_elements, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :project, type: :uuid, null: false, foreign_key: true
      t.references :parent, type: :uuid, foreign_key: { to_table: :source_elements }
      t.string :element_type, null: false
      t.string :title
      t.text :source
      t.text :pretext_source
      t.integer :position, null: false, default: 0

      t.timestamps
    end

    add_index :source_elements, [ :project_id, :parent_id, :position ]
  end
end
