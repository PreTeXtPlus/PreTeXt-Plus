class AddUsernameToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :username, :string
    # Case-insensitive: "Alice" and "alice" collide even though the column itself
    # keeps whatever casing the user typed (see User#normalizes).
    add_index :users, "lower(username)", unique: true, name: "index_users_on_lower_username"
  end
end
