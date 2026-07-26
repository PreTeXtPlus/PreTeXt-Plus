# An html build has an index.html to open; a pdf build is a single file whose name
# PreTeXt chooses, and a SCORM build is a package rather than either. Recorded per build
# at import time rather than guessed per kind afterwards, so "View" and the published URL
# work for any output the CLI produces.
class AddEntryPathToBuilds < ActiveRecord::Migration[8.1]
  def change
    add_column :builds, :entry_path, :string

    reversible do |dir|
      dir.up do
        # Every build that exists today is html output from the single hardcoded `web`
        # target, so its entry point is the index the old views already assumed.
        execute <<~SQL
          UPDATE builds SET entry_path = 'index.html'
          WHERE status = 2
        SQL
      end
    end
  end
end
