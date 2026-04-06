class AddLatexSupportToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :source_format, :integer, default: 0, null: false
    add_column :projects, :document_type, :integer
    add_column :projects, :pretext_source, :text
    rename_column :projects, :content, :source
  end
end
