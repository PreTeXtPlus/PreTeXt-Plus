class ReplaceTrialDateWithTrialDays < ActiveRecord::Migration[8.1]
  def up
    add_column :subscription_types, :trial_days, :integer, default: 0, null: false
    remove_column :subscription_types, :trial_date
  end

  def down
    add_column :subscription_types, :trial_date, :string
    remove_column :subscription_types, :trial_days
  end
end
