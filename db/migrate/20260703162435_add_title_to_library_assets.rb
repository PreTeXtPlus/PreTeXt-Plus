class AddTitleToLibraryAssets < ActiveRecord::Migration[8.1]
  def change
    add_column :library_assets, :title, :string
    rename_column :library_assets, :content, :source
  end
end
