# Publication settings become publication XML: one fragment per level, stored as the author
# (or the build settings modal, on their behalf) wrote it. The modal is now an editor over
# that XML, the way the exercise editors are over an exercise's source -- see
# Publication::Document and HasPublicationSettings.
#
# Backfilled from the jsonb column this replaces, by writing each stored setting at the
# path its catalog entry names. That makes this migration depend on Publication::Catalog as
# it stands when it runs; the catalog only ever gains options, and a key it no longer knows
# was already ignored by every build, so dropping one here loses nothing a build had.
#
# The jsonb column stays, unread (HasPublicationSettings ignores it), until a later
# migration drops it -- the same two steps projects.root_element took, so a deploy never
# has old code looking for a column that is gone.
class StorePublicationSettingsAsXml < ActiveRecord::Migration[8.1]
  TABLES = %i[ users projects targets ].freeze

  def up
    TABLES.each do |table|
      add_column table, :publication_xml, :text

      select_rows("SELECT id, publication_settings FROM #{table} WHERE publication_settings <> '{}'")
        .each do |id, settings|
          settings = JSON.parse(settings) if settings.is_a?(String)
          xml = Publication::Document.write(nil, settings)
          next if xml.nil?

          execute "UPDATE #{table} SET publication_xml = #{quote(xml)} WHERE id = #{quote(id)}"
        end
    end
  end

  def down
    TABLES.each { |table| remove_column table, :publication_xml }
  end
end
