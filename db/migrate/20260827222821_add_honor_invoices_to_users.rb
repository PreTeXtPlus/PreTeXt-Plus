class AddHonorInvoicesToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :honor_invoices, :boolean, default: false
  end
end
