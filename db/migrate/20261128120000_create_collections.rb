class CreateCollections < ActiveRecord::Migration[8.1]
  def change
    create_table :collections, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.string :name, null: false
      t.text :description
      t.integer :visibility, default: 0, null: false
      t.timestamps
    end
  end
end
