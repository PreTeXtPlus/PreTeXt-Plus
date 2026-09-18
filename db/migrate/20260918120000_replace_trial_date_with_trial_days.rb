class ReplaceTrialDateWithTrialDays < ActiveRecord::Migration[8.1]
  def up
    add_column :subscription_types, :trial_days, :integer, default: 0, null: false
    execute <<~SQL.squish
      UPDATE subscription_types SET trial_days = 7
      WHERE stripe_price_id IS NOT NULL AND stripe_price_id <> ''
    SQL
    remove_column :subscription_types, :trial_date
  end

  def down
    add_column :subscription_types, :trial_date, :string
    remove_column :subscription_types, :trial_days
  end
end
