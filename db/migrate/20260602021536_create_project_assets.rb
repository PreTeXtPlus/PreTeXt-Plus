class CreateProjectAssets < ActiveRecord::Migration[8.1]
  def change
    create_table :project_assets, id: :uuid do |t|
      t.references :library_asset, null: false, foreign_key: true, type: :uuid
      t.references :project, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
  end
end
