# frozen_string_literal: true

# Takes the automatic backups (see ProjectBackup) of every project edited lately.
#
# Collaborative projects are read from their rows like any other, which
# ProjectDocProjectionJob keeps within a minute of the live document -- close
# enough for a backup whose whole promise is "within ten minutes".
class ProjectBackupJob < ApplicationJob
  queue_as :default

  # Wider than the ten-minute schedule so a skipped run (a deploy, a backlog)
  # does not let an edit slip past unbacked-up. Overlap costs nothing:
  # ProjectBackup#due? skips any project already backed up since its last edit.
  LOOKBACK = 15.minutes

  def perform
    Project.unscope(:order).where(updated_at: LOOKBACK.ago..).includes(:user).find_each do |project|
      ProjectBackup.new(project).rotate!
    rescue StandardError => e
      # One project that will not back up must not stop the rest.
      Honeybadger.notify(e, context: { project_id: project.id })
      Rails.logger.error("[backup] backup failed for project #{project.id}: #{e.message}")
    end
  end
end
