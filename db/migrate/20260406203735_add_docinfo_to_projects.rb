class AddDocinfoToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :docinfo, :text
  end
end
