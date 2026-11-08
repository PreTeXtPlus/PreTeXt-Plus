# frozen_string_literal: true

# A daily look for collaborative documents whose rows may have stopped following
# them, reported as one Honeybadger notice rather than discovered a day later
# from a failing build.
#
# Twice in November 2026 a project's rows silently froze behind its document
# (see ProjectDocProjection). The projection now survives a bad record and lists
# it on the project, so the first signal below is the ordinary one. The other
# two cover what no single projection can see about itself: a document yrby has
# quarantined part of, and a document that has been written to but not
# projected since, whatever the reason.
#
# Nothing is at risk while this is quiet: every keystroke is durable in the
# document from the moment the server records it. What lags is the saved copy
# of the project -- builds, copies, downloads -- which is why it is worth a
# daily notice but not a page.
class ProjectionHealthJob < ApplicationJob
  queue_as :default

  # An update row yrby marks `pending` carries a causal gap: it cannot fold into
  # the snapshot until the update it depends on arrives. One that has waited
  # this long is not going to.
  STALE_PENDING_AFTER = 1.hour

  # How far the last projection may trail the document's last change before it
  # is worth a word. ProjectDocProjectionJob runs every minute, so a healthy
  # document is never more than a minute or two behind.
  LAG_TOLERANCE = 15.minutes

  # Documents quiet for longer than this are left out of the lag check: nothing
  # projects a quiet document, so an old one checked under an earlier release
  # (or never, before `projection_checked_at` existed) would otherwise be
  # reported every day forever.
  ACTIVITY_WINDOW = 7.days

  def perform
    report = {
      projects_with_issues: projects_with_issues,
      projects_with_stale_pending_updates: projects_with_stale_pending_updates,
      projects_whose_projection_lags: projects_whose_projection_lags
    }
    return if report.values.all?(&:empty?)

    Honeybadger.notify(
      "Collaborative projection health: #{report.map { |k, v| "#{v.size} #{k.to_s.humanize.downcase}" }.join(', ')}",
      error_class: "Collab::ProjectionHealth",
      fingerprint: "projection-health",
      context: report
    )
    Rails.logger.warn("[collab] projection health: #{report.to_json}")
  end

  private

    def projects_with_issues
      Project.where("projection_issues <> '[]'::jsonb").order(:id).pluck(:id)
    end

    def projects_with_stale_pending_updates
      document_ids = Y::DocumentUpdate.where(pending: true, created_at: ...STALE_PENDING_AFTER.ago)
                                      .distinct.pluck(:document_id)
      project_ids_for(Y::Document.where(id: document_ids).pluck(:key))
    end

    # A document's last change is the newer of its snapshot's timestamp and its
    # newest update row -- compaction folds the tail into the snapshot and
    # deletes the rows it folded, so either alone can miss it (the same two
    # signals ProjectDocProjectionJob reads).
    def projects_whose_projection_lags
      documents = Y::Document.where("key LIKE 'project/%/doc'").pluck(:id, :key, :updated_at)
      latest_update = Y::DocumentUpdate.where(document_id: documents.map(&:first))
                                       .group(:document_id).maximum(:created_at)
      activity = documents.filter_map do |id, key, updated_at|
        project_id = ProjectDoc.project_id_from(key) or next
        [ project_id, [ updated_at, latest_update[id] ].compact.max ]
      end.to_h.select { |_id, at| at > ACTIVITY_WINDOW.ago }
      return [] if activity.empty?

      checked = Project.where(id: activity.keys).pluck(:id, :projection_checked_at).to_h
      activity.filter_map do |project_id, last_change|
        next unless checked.key?(project_id) # the document outlived its project

        checked_at = checked[project_id]
        project_id if checked_at.nil? || checked_at < last_change - LAG_TOLERANCE
      end.sort
    end

    def project_ids_for(keys)
      keys.filter_map { |key| ProjectDoc.project_id_from(key) }.sort
    end
end
