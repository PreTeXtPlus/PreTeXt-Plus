# frozen_string_literal: true

# Rewrite every stored source to "\n" line endings.
#
# A source written with Windows' "\r\n" -- typed into a division that started
# empty in a browser on Windows, where the code editor defaulted to it, or
# imported from a file saved that way -- converts wrongly when it is LaTeX-style:
# the converter counts "\r" and "\n" as a line end each, so every line became
# its own paragraph. Content now normalizes `source` on every write
# (Content.normalize_line_endings); this brings the rows already stored into
# line, with the same rule: "\r\n" and a lone "\r" each become "\n".
#
# In SQL, without loading a record: no callbacks, no validations, and no
# `updated_at` bump, since nobody edited anything. The projects that own a
# changed row do get `source_updated_at` moved, because what they assemble to
# has changed and a build made before this is stale.
#
# Collaborative documents are not touched (yrby cannot write one). A document
# that still holds a "\r\n" projects onto these rows normalized, and the editor
# removes it from the document the next time anyone opens the project.
class NormalizeContentLineEndings < ActiveRecord::Migration[8.1]
  def up
    say_with_time "normalizing line endings in content sources" do
      project_ids = select_values("SELECT DISTINCT project_id FROM contents WHERE position(E'\\r' in source) > 0")
      changed = update(<<~SQL.squish)
        UPDATE contents
        SET source = replace(replace(source, E'\\r\\n', E'\\n'), E'\\r', E'\\n')
        WHERE position(E'\\r' in source) > 0
      SQL
      project_ids.each_slice(500) do |ids|
        update("UPDATE projects SET source_updated_at = CURRENT_TIMESTAMP WHERE id IN (#{ids.map { |id| quote(id) }.join(', ')})")
      end
      changed
    end
  end

  # Which sources had which endings is not recorded, and nothing reads the
  # difference, so there is nothing to put back.
  def down; end
end
