class FixProjectSourceColumnNames < ActiveRecord::Migration[8.1]
  def up
    rename_column :projects, :content, :source if column_exists?(:projects, :content)
    rename_column :projects, :pretext_content, :pretext_source if column_exists?(:projects, :pretext_content)
  end

  def down
    rename_column :projects, :source, :content if column_exists?(:projects, :source)
    rename_column :projects, :pretext_source, :pretext_content if column_exists?(:projects, :pretext_source)
  end
end
