class DropLibraryAssetsAndProjectAssets < ActiveRecord::Migration[8.1]
  def up
    remove_foreign_key :project_assets, :library_assets
    remove_foreign_key :project_assets, :projects
    remove_foreign_key :library_assets, :users
    drop_table :project_assets
    drop_table :library_assets
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
