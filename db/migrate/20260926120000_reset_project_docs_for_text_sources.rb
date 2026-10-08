# frozen_string_literal: true

# Start every collaborative document over, so snippets and assets carry their
# source as shared text.
#
# Snippet and asset sources used to be plain last-writer-wins strings in the
# document, edited through modal dialogs; they are now edited in the code editor
# beside divisions and live in the document as nested Y.Text, exactly like a
# division's. yrby can read a document but not write one, so an existing
# document cannot be upgraded in place -- and the editor reads only the new
# shape. Instead each document is projected one last time, flushing whatever its
# session had not yet written to the rows, and then dropped. The next session
# seeds a fresh document from those rows, in the new shape.
#
# Runs in a maintenance window: nobody is connected, so nothing is lost between
# the projection and the drop. A document that will not project is still
# dropped -- its rows are what the editor already persisted, and a document
# left in the old shape would read as empty text in the new editor.
class ResetProjectDocsForTextSources < ActiveRecord::Migration[8.1]
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
