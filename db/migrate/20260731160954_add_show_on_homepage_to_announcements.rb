class AddShowOnHomepageToAnnouncements < ActiveRecord::Migration[8.1]
  def change
    add_column :announcements, :show_on_homepage, :boolean, default: false, null: false
  end
end
