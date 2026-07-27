class AddVisibilityToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :visibility, :integer, default: 0, null: false
    add_index :projects, [ :user_id, :visibility ]
  end
end
