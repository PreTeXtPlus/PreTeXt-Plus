class CreateLibraryAssets < ActiveRecord::Migration[8.1]
  def change
    create_table :library_assets, id: :uuid do |t|
      t.string :filename
      t.references :user, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
  end
end
