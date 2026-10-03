# frozen_string_literal: true

# Takes a project's automatic backup and rotates the older ones down the tiers.
#
# A project keeps at most one backup per Project::BACKUP_TIERS slot. Each new
# snapshot lands in `recent`; before it does, every slot whose backup has
# outgrown that slot's age is replaced by the next-younger backup, oldest slot
# first, so a backup is promoted (its tier rewritten) rather than copied again.
# Run every ten minutes against projects that have changed, that settles into
# backups about 10 minutes, 1 hour, 3 hours and 1 day behind the last edit.
#
# A project nobody touches is left alone, rotation included: the backups an
# author comes back to after a week away are the ones from before they left,
# not four copies of what they left behind.
#
# A subscriber feature, keyed to the OWNER's plan like every other per-project
# benefit (see Project#collaborator_limit). A lapsed subscription stops new
# backups but leaves the existing ones to be restored.
class ProjectBackup
  def initialize(project)
    @project = project
  end

  # @return [Project, nil] the new backup, or nil when none was due.
  def rotate!
    return nil unless due?

    Project.transaction do
      promote_aged_backups
      take_snapshot
    end
  end

  def due?
    return false if @project.backup?
    return false unless @project.user&.has_subscriber_benefits?

    latest = backups_by_tier[:recent]
    latest.nil? || last_edited_at > latest.backed_up_at
  end

  private

    # updated_at as well as source_updated_at: a title change is an edit an
    # author would want back, even though it does not make a build stale.
    def last_edited_at
      [ @project.source_updated_at, @project.updated_at ].compact.max
    end

    def backups_by_tier
      @backups_by_tier ||= @project.backups.index_by { |backup| backup.backup_tier.to_sym }
    end

    def promote_aged_backups
      tiers = Project::BACKUP_TIERS.keys
      # Oldest slot first, so each promotion frees the slot the next one moves into.
      tiers.each_index.drop(1).reverse_each do |index|
        tier, younger_tier = tiers[index], tiers[index - 1]
        current = backups_by_tier[tier]
        younger = backups_by_tier[younger_tier]
        next if younger.nil?
        next if current && current.backed_up_at > Project::BACKUP_TIERS[tier].ago

        current&.destroy!
        younger.update_columns(backup_tier: Project.backup_tiers[tier])
        backups_by_tier[tier] = younger
        backups_by_tier.delete(younger_tier)
      end
      # Whatever is still in `recent` was not old enough to promote; the new
      # snapshot supersedes it.
      backups_by_tier.delete(:recent)&.destroy!
    end

    def take_snapshot
      backup = @project.full_dup(@project.user)
      backup.title = @project.title
      backup.html_source = nil
      backup.visibility = "private"
      backup.backup_of_id = @project.id
      backup.backup_tier = :recent
      backup.backed_up_at = Time.current
      backup.save!
      backups_by_tier[:recent] = backup
    end
end
