class AddTrialDate < ActiveRecord::Migration[8.1]
  def change
    add_column :subscription_types, :trial_date, :string
  end
end
