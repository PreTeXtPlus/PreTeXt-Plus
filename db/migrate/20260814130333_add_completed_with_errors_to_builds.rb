class AddCompletedWithErrorsToBuilds < ActiveRecord::Migration[8.0]
  def change
    add_column :builds, :completed_with_errors, :boolean, default: false, null: false
  end
end
