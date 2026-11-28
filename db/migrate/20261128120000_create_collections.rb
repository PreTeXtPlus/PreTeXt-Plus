class CreateCollections < ActiveRecord::Migration[8.1]
  def change
    create_table :collections, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      # Indexed by the unique [user_id, slug] index below, which leads with user_id.
      t.references :user, type: :uuid, null: false, foreign_key: true, index: false
      t.string :name, null: false
      t.string :slug, null: false
      t.text :description
      t.integer :visibility, default: 0, null: false
      t.timestamps
    end
    add_index :collections, [ :user_id, :slug ], unique: true
  end
end
