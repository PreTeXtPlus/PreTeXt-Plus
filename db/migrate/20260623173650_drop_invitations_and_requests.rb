class DropInvitationsAndRequests < ActiveRecord::Migration[8.1]
  def change
    drop_table :requests, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end

    drop_table :invitations, id: :uuid do |t|
      t.uuid :code, default: -> { "gen_random_uuid()" }, null: false
      t.references :owner_user, null: false, foreign_key: { to_table: :users }, type: :uuid
      t.references :recipient_user, null: true, foreign_key: { to_table: :users }, type: :uuid
      t.string :intended_email

      t.timestamps

      t.index :code, unique: true
    end
  end
end
