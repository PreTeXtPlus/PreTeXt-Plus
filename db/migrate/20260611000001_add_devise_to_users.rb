class AddDeviseToUsers < ActiveRecord::Migration[8.1]
  def up
    # database_authenticatable: rename existing bcrypt column
    rename_column :users, :password_digest, :encrypted_password

    # recoverable
    add_column :users, :reset_password_token, :string
    add_column :users, :reset_password_sent_at, :datetime

    # rememberable
    add_column :users, :remember_created_at, :datetime

    # trackable (replaces custom sessions table for admin visibility)
    add_column :users, :sign_in_count, :integer, default: 0, null: false
    add_column :users, :current_sign_in_at, :datetime
    add_column :users, :last_sign_in_at, :datetime
    add_column :users, :current_sign_in_ip, :string
    add_column :users, :last_sign_in_ip, :string

    # confirmable
    add_column :users, :confirmation_token, :string
    add_column :users, :confirmed_at, :datetime
    add_column :users, :confirmation_sent_at, :datetime
    add_column :users, :unconfirmed_email, :string

    add_index :users, :reset_password_token, unique: true
    add_index :users, :confirmation_token, unique: true

    # Mark all existing users as already confirmed so they aren't locked out.
    execute "UPDATE users SET confirmed_at = NOW()"

    drop_table :sessions
  end

  def down
    create_table :sessions, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.uuid :user_id, null: false
      t.string :user_agent
      t.string :ip_address
      t.timestamps
    end
    add_index :sessions, :user_id
    add_foreign_key :sessions, :users

    remove_index :users, :confirmation_token
    remove_index :users, :reset_password_token

    remove_column :users, :unconfirmed_email
    remove_column :users, :confirmation_sent_at
    remove_column :users, :confirmed_at
    remove_column :users, :confirmation_token
    remove_column :users, :last_sign_in_ip
    remove_column :users, :current_sign_in_ip
    remove_column :users, :last_sign_in_at
    remove_column :users, :current_sign_in_at
    remove_column :users, :sign_in_count
    remove_column :users, :remember_created_at
    remove_column :users, :reset_password_sent_at
    remove_column :users, :reset_password_token

    rename_column :users, :encrypted_password, :password_digest
  end
end
