class CreateCollectionMemberships < ActiveRecord::Migration[8.1]
  def change
    create_table :collection_memberships, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :collection, type: :uuid, null: false, foreign_key: true, index: false
      t.references :project, type: :uuid, null: false, foreign_key: true
      t.integer :position, null: false
      t.timestamps
    end
    add_index :collection_memberships, [ :collection_id, :project_id ], unique: true
    # Not unique: a reorder rewrites positions one row at a time, and must not
    # collide with a sibling's old value partway through.
    add_index :collection_memberships, [ :collection_id, :position ]
  end
end
