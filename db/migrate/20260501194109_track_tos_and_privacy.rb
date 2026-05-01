class TrackTosAndPrivacy < ActiveRecord::Migration[8.1]
  def change
    create_table :terms, id: :uuid do |t|
      t.text :content
      t.integer :policy_type, default: 0, null: false

      t.timestamps
    end
    add_reference :users, :tos, type: :uuid
    add_reference :users, :privacy, type: :uuid
  end
end
