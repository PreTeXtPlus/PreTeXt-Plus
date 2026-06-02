class CreateAssets < ActiveRecord::Migration[8.1]
  def change
    create_table :assets, id: :uuid do |t|
      t.string :filename
      t.references :user, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
    create_table :project_assets, id: :uuid do |t|
      t.references :asset, null: false, foreign_key: true, type: :uuid
      t.references :project, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
  end
end
