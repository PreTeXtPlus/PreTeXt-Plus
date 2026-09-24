# frozen_string_literal: true

# Write recently-edited collaborative documents out into their projects' rows.
#
# The document is the session's truth while anyone is editing; the rows are the
# view of it everything outside the editor reads -- the dashboard, the
# share/source view, `projects#download`, and anything else that asks a Project
# what it says. The browser used to keep those rows current with a ten-second
# autosave elected to one tab; it does not write them at all any more, so this
# is what keeps them from going stale.
#
# It is a backstop, not the mechanism. The two places where staleness would
# actually be felt do their own projection, synchronously, and do not wait for
# this: FullBuildJob before it assembles a build's source, and
# ProjectDocsController#flush when an author saves and closes or copies the
# project. What is left for this job is the reader who never asked for either --
# someone looking at a collaborator's project page while the session is still
# going.
#
# Nothing is at risk while this lags. Every keystroke is durable in the document
# from the moment the server records it (ProjectDocChannel); a lagging
# projection is a staleness question for readers, not a data-loss one.
class ProjectDocProjectionJob < ApplicationJob
  queue_as :default

  # How far back to look for activity. Generous against the every-minute
  # schedule on purpose, in both directions:
  #
  # * Overlap is free. The projection derives everything from the document and
  #   writes the same rows given the same document, so projecting one twice
  #   costs ~15ms and changes nothing -- including `source_updated_at`, which a
  #   projection that changes nothing deliberately leaves alone.
  # * Skipped runs are survivable. A deploy or a queue backlog can eat several
  #   minutes without any document's work falling outside the window.
  #
  # It also has to be bounded, which is the other half of the choice: a document
  # that has been quiet for longer than this stops being projected, so an
  # archive of finished projects does not cost a projection a minute forever.
  LOOKBACK = 15.minutes

  def perform
    projects_with_recent_activity.each do |project|
      ProjectDocProjection.new(project).apply!
    rescue StandardError => e
      # One project that will not project must not stop the rest. Its rows stay
      # as they were, which is stale rather than wrong, and the document itself
      # is untouched.
      Honeybadger.notify(e, context: { project_id: project.id })
      Rails.logger.error("[collab] projection failed for project #{project.id}: #{e.message}")
    end
  end

  private

    def projects_with_recent_activity
      Project.where(id: active_project_ids)
    end

    # Two signals, because a document's work lives in two places and moves
    # between them. An edit appends a row to the update tail; compaction folds
    # that tail into the snapshot and deletes the rows it folded. So a document
    # edited and then compacted within one window would be invisible to either
    # signal alone -- the tail is gone, and without the second query so is any
    # trace that it changed.
    def active_project_ids
      since = LOOKBACK.ago
      document_ids = Y::DocumentUpdate.where(created_at: since..).distinct.pluck(:document_id)
      document_ids |= Y::Document.where(updated_at: since..).pluck(:id)
      return [] if document_ids.empty?

      Y::Document.where(id: document_ids).pluck(:key).filter_map { |key| ProjectDoc.project_id_from(key) }
    end
end
