class CreateAnnouncements < ActiveRecord::Migration[8.1]
  def change
    create_table :announcements, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.string :title, null: false
      t.text :body, null: false
      t.datetime :published_at
      t.timestamps
    end

    add_column :users, :announcement_emails, :boolean, default: true, null: false
    add_column :users, :announcement_unsubscribe_token, :string
    add_index :users, :announcement_unsubscribe_token, unique: true
  end
end
