# frozen_string_literal: true

# `pretext_source` held the assembled standalone document, written by the
# browser on a ten-second autosave and read by ProjectArchiveBuilder. Two
# writers for one row is what let an idle collaborator's tab overwrite source a
# build had just consumed; the fix is not another lock but removing the stored
# copy, since the document is derivable from the rows beside it. SourceAssembler
# now assembles it when a build asks, and nothing stores it.
#
# One thing was only ever read off that column rather than assembled from it:
# the document's root element, which Project#structural_document_type uses to
# tell an article from a book. That cannot be recomputed cheaply -- it needs the
# latex/markdown converters -- so it moves into a column of its own, and is
# backfilled here while the source to read it from still exists.
class ReplacePretextSourceWithRootElement < ActiveRecord::Migration[8.1]
  # The root-only elements a PreTeXt document can open with. Anything above or
  # before one of these in the document (<pretext>, <docinfo>) simply does not
  # match, which is why scanning for the first hit is enough.
  ROOT_ELEMENTS = %w[ article book slideshow ].freeze

  def up
    add_column :projects, :root_element, :string

    # suppress_messages because a migration logs every statement it issues by
    # name, and this issues two per project: on a real table the useful line
    # ("n rows") would be somewhere in the middle of tens of thousands.
    say_with_time "backfilling projects.root_element from pretext_source" do
      suppress_messages { backfill }
    end

  end

  def down
    remove_column :projects, :root_element
  end

  private

    # Read in batches of ids first: pretext_source is a whole book per row, so
    # selecting every one of them at once is a way to run a migration out of
    # memory on a large table.
    def backfill
      updated = 0
      ids = select_values("SELECT id FROM projects WHERE pretext_source IS NOT NULL AND pretext_source <> ''")

      ids.each_slice(200) do |slice|
        list = slice.map { |id| quote(id) }.join(",")
        select_rows("SELECT id, pretext_source FROM projects WHERE id IN (#{list})").each do |id, source|
          element = root_element_of(source)
          next if element.nil?

          update("UPDATE projects SET root_element = #{quote(element)} WHERE id = #{quote(id)}")
          updated += 1
        end
      end

      updated
    end

    # The same streamed read Project#root_element_type did, kept here rather than
    # called there because that method goes away with the column it read.
    # A document that parses to nothing recognisable is left null, which
    # structural_document_type reads as "fall back to document_type" -- the same
    # answer it gave before.
    def root_element_of(source)
      Nokogiri::XML::Reader(source).each do |node|
        next unless node.node_type == Nokogiri::XML::Reader::TYPE_ELEMENT
        return node.name if ROOT_ELEMENTS.include?(node.name)
      end
      nil
    rescue Nokogiri::XML::SyntaxError
      nil
    end
end
