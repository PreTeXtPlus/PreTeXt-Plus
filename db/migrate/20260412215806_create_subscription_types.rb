class CreateSubscriptionTypes < ActiveRecord::Migration[8.1]
  def change
    create_table :subscription_types, id: :uuid do |t|
      t.string :name
      t.text :description
      t.text :bulletpoints
      t.string :stripe_price_id
      t.integer :order

      t.timestamps
    end
  end
end
