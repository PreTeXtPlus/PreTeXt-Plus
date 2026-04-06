class AddDocinfoToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :docinfo_macros, :text
    add_column :projects, :docinfo_latex_image_preamble, :text
  end
end
