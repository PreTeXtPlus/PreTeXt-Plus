class AddTemplateFieldsToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :is_template, :boolean, default: false, null: false
    add_column :projects, :template_description, :text
    add_index :projects, :is_template
  end
end
