class AddBuildFieldsToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :build_status, :string, null: false, default: "pending"
    add_column :projects, :last_build_started_at, :datetime
    add_column :projects, :last_build_finished_at, :datetime
    add_column :projects, :last_build_error, :text
    add_column :projects, :artifact_prefix, :string
    add_column :projects, :artifact_manifest, :jsonb, null: false, default: {}

    add_index :projects, :build_status
  end
end