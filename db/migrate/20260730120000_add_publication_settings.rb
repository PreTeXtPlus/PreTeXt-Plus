# The publisher's choices -- theme, chunking, division numbering -- at each of the three
# levels they can be made at. Same column on all three tables because the merge that
# resolves them (Publication::Settings) treats the levels identically.
#
# Only keys the author actually chose are stored: "inherit" is the *absence* of a key, so
# an empty hash means "whatever the level above decided", and merging is Hash#merge.
class AddPublicationSettings < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :publication_settings, :jsonb, default: {}, null: false
    add_column :projects, :publication_settings, :jsonb, default: {}, null: false
    add_column :targets, :publication_settings, :jsonb, default: {}, null: false
  end
end
