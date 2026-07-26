# Two columns needed once a target can be something other than a website.
#
# targets.compression -- PreTeXt's project.ptx schema has no `scorm` format. A SCORM
# package is an html target with compression="scorm" (and a plain zip is
# compression="zip"), so the packaging is a separate axis from the format.
#
# builds.entry_path -- an html build has an index.html to open; a pdf build is a single
# file whose name PreTeXt chooses. Recorded per build at import time rather than guessed
# per format, so "View" and the published URL work for any output the CLI produces.
class AddMultiFormatSupportToTargets < ActiveRecord::Migration[8.1]
  def change
    add_column :targets, :compression, :string
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
