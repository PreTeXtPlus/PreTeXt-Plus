class AddInvoicableToSubscriptionTypes < ActiveRecord::Migration[8.1]
  def change
    add_column :subscription_types, :invoiceable, :boolean
  end
end
