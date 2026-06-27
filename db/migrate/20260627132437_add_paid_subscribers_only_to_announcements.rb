class AddPaidSubscribersOnlyToAnnouncements < ActiveRecord::Migration[8.1]
  def change
    add_column :announcements, :paid_subscribers_only, :boolean, default: false, null: false
  end
end
