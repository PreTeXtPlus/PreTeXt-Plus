class MakeRootDivisionNullableOnProjects < ActiveRecord::Migration[8.1]
  def change
    change_column_null :projects, :root_division_id, true
  end
end
