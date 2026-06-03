class ExtendAssets < ActiveRecord::Migration[8.1]
  def change
    add_column :library_assets, :content, :text
    add_column :library_assets, :type, :integer, default: 0, null: false
    add_column :library_assets, :short_description, :string
    add_column :library_assets, :description, :text
    remove_column :library_assets, :filename, :string
    add_column :project_assets, :ref, :string
  end
end
