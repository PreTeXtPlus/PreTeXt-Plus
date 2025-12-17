class CreateInvitations < ActiveRecord::Migration[8.1]
  def change
    create_table :invitations, id: :uuid do |t|
      t.uuid :code, default: "gen_random_uuid()", null: false
      t.references :owner_user, null: false, type: :uuid
      t.references :recipient_user, null: true, type: :uuid

      t.timestamps
    end
    add_index :invitations, :code, unique: true
    add_foreign_key :invitations, :users, column: :owner_user_id, primary_key: :id
    add_foreign_key :invitations, :users, column: :recipient_user_id, primary_key: :id
  end
end
