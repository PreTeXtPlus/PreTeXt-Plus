# frozen_string_literal: true

# Start every collaborative document over, so a division's element lives in
# its entry's fields rather than in its text (collab schema version 3).
#
# A version-2 document holds each division's whole source, wrapper element
# included, as shared text; a version-3 editor reads that text as the body and
# builds the element from the fields -- so it would show, and assemble, every
# division wrapped twice. yrby can read a document but not write one, so as in
# ResetProjectDocsForTextSources each document is projected one last time,
# flushing whatever its session had not yet written to the rows, and then
# dropped. SplitDivisionMetadataOutOfSources, which runs next, takes the
# flushed sources apart; the next session seeds a fresh document from the rows.
#
# Runs in a maintenance window: nobody is connected, so nothing is lost between
# the projection and the drop. A document that will not project is still
# dropped -- its rows are what the editor already persisted, and a document
# left in the old shape would show every division wrapped twice.
class ProjectAndResetDocsForContentFields < ActiveRecord::Migration[8.1]
  def up
    say_with_time "projecting and resetting collaborative documents" do
      keys = Y::Document.pluck(:key).select { |key| ProjectDoc.project_id_from(key) }
      keys.each do |key|
        project = Project.find_by(id: ProjectDoc.project_id_from(key))
        begin
          ProjectDocProjection.new(project).apply! if project
        rescue StandardError => e
          say "could not project #{key} before resetting it: #{e.message}", true
        end
        Y::Document.where(key: key).destroy_all
      end
      keys.size
    end
  end

  # Deliberately one-way: the documents are gone, and the rows they were
  # projected into are what a new session seeds from either way.
  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
