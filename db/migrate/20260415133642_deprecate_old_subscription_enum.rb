class DeprecateOldSubscriptionEnum < ActiveRecord::Migration[8.1]
  def change
    rename_column :users, :subscription, :old_subscription
  end
end
