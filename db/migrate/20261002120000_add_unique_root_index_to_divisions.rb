# frozen_string_literal: true

# Division's uniqueness validation on is_root checks with a SELECT before it
# inserts, so two requests creating a root for the same project at once could
# both pass it. This makes "at most one root per project" the database's to
# enforce; "at least one" is kept by Division and Project themselves.
class AddUniqueRootIndexToDivisions < ActiveRecord::Migration[8.1]
  def change
    add_index :divisions, :project_id, unique: true, where: "is_root",
              name: "index_divisions_on_project_id_unique_root"
  end
end
