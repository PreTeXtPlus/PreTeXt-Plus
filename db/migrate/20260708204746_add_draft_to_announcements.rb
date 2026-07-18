class AddDraftToAnnouncements < ActiveRecord::Migration[8.1]
  def change
    add_column :announcements, :draft, :boolean, default: true, null: false

    reversible do |dir|
      dir.up do
        Announcement.where.not(published_at: nil).update_all(draft: false)
      end
    end
  end
end
