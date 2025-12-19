class SaveProjectResult < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :html, :text
  end
end
