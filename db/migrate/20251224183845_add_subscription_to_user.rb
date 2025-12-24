class AddSubscriptionToUser < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :subscription, :integer, null: false, default: 0
    add_column :users, :stripe_checkout_session_id, :string
  end
end
