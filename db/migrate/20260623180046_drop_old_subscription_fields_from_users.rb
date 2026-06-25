class DropOldSubscriptionFieldsFromUsers < ActiveRecord::Migration[8.1]
  def change
    remove_column :users, :old_subscription, :integer, default: 0, null: false
    remove_column :users, :stripe_checkout_session_id, :string
    remove_column :users, :stripe_customer_id, :string
  end
end
