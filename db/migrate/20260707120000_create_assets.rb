class CreateAssets < ActiveRecord::Migration[8.1]
  def change
    create_table :assets, id: :uuid do |t|
      t.references :project, null: false, foreign_key: true, type: :uuid
      t.string :ref
      t.integer :kind, default: 0, null: false
      t.text :source
      t.string :short_description
      t.text :description
      t.string :title

      t.timestamps
    end
  end
end
