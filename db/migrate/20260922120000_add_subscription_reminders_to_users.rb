class AddSubscriptionRemindersToUsers < ActiveRecord::Migration[8.1]
  def change
    # No default: nil means "use the plan's interval-based default" (see
    # SubscriptionExtensions#reminders_enabled?), while true/false is an explicit
    # override.
    add_column :users, :subscription_reminders, :boolean
  end
end
