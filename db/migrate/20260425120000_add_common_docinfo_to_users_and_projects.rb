class AddCommonDocinfoToUsersAndProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :common_docinfo, :text
    add_column :projects, :use_common_docinfo, :boolean, default: false, null: false
  end
end
