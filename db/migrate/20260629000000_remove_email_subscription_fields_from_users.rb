class RemoveEmailSubscriptionFieldsFromUsers < ActiveRecord::Migration[8.1]
  def change
    remove_index :users, :announcement_unsubscribe_token
    remove_column :users, :announcement_emails, :boolean
    remove_column :users, :announcement_unsubscribe_token, :string
  end
end
