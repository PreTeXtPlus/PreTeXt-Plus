class ReplaceBuildErrorFlagsWithStatusValues < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      UPDATE builds SET status = 9  -- success_awaiting_review
      WHERE status = 2 AND completed_with_errors = true AND errors_accepted = false
    SQL
    execute <<~SQL
      UPDATE builds SET status = 10 -- success_errors_accepted
      WHERE status = 2 AND completed_with_errors = true AND errors_accepted = true
    SQL
    execute <<~SQL
      UPDATE builds SET status = 8  -- received_from_server_flagged
      WHERE status = 5 AND completed_with_errors = true
    SQL

    remove_column :builds, :completed_with_errors
    remove_column :builds, :errors_accepted
  end

  def down
    add_column :builds, :completed_with_errors, :boolean, default: false, null: false
    add_column :builds, :errors_accepted, :boolean, default: false, null: false

    execute <<~SQL
      UPDATE builds SET status = 2, completed_with_errors = true, errors_accepted = false
      WHERE status = 9
    SQL
    execute <<~SQL
      UPDATE builds SET status = 2, completed_with_errors = true, errors_accepted = true
      WHERE status = 10
    SQL
    execute <<~SQL
      UPDATE builds SET status = 5, completed_with_errors = true
      WHERE status = 8
    SQL
  end
end
