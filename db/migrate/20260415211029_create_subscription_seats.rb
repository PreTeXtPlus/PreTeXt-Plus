class CreateSubscriptionSeats < ActiveRecord::Migration[8.1]
  def change
    create_table :subscription_seats, id: :uuid do |t|
      t.references :pay_subscription, null: false, foreign_key: true, type: :uuid
      t.references :user, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
  end
end
