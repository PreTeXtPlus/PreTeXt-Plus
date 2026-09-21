# HTTP persistence for a project's collaborative Yjs document. All payloads
# are opaque binary carried as base64 in JSON; the CRDT semantics live
# entirely in the clients. Live update relay is ProjectDocChannel; these
# endpoints only cover joining (show), first-time seeding (seed), and
# compaction (update).
class ProjectDocsController < ApplicationController
  before_action :set_project

  # How long a log row is kept past the point a client says it has merged it.
  #
  # `project_doc_updates.id` comes from a sequence, and a sequence value is
  # allocated at INSERT, before COMMIT. So a reader ordering by id -- #show
  # here, and solid_cable's broadcast poller on the other leg -- can pass over a
  # row whose id is *lower* than one it has already returned, and a compacting
  # client can end up claiming to have merged an update it never saw. Deleting
  # that row would destroy the update for the whole session: the snapshot
  # replacing it does not contain it, and nothing else does either.
  #
  # So the id a client offers is treated as a ceiling rather than a licence.
  # Anything younger than this stays, whoever claims it, which leaves the skipped
  # row in place for the catch-up fetch that yCableProvider's seq-gap detection
  # triggers within a poll or two. Compaction runs once a minute and exists to
  # bound the log, not to empty it, so the cost of holding a few more rows for
  # this long is nothing.
  COMPACTION_GRACE = 30.seconds

  # GET /projects/:id/doc
  # Everything a joining client needs: the last compacted snapshot plus every
  # update appended since. Applying them in any order converges.
  def show
    doc = @project.project_doc
    updates = @project.project_doc_updates.order(:id)
    render json: {
      seeded: doc.present?,
      snapshot: doc&.snapshot ? Base64.strict_encode64(doc.snapshot) : nil,
      updates: updates.map { |u| { id: u.id, payload: Base64.strict_encode64(u.payload) } }
    }
  end

  # POST /projects/:id/doc/seed
  # Compare-and-set creation of the doc. Exactly one client may seed: two
  # clients each seeding an empty doc and then syncing would duplicate every
  # division's text (the CRDT rightly treats the seeds as concurrent inserts).
  # The unique index on project_id arbitrates the race; losers get 409 and
  # re-fetch the winner's snapshot.
  def seed
    @project.create_project_doc!(snapshot: decoded_snapshot)
    head :created
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
    head :conflict
  end

  # PUT /projects/:id/doc
  # Compaction: replace the snapshot with a full state that has incorporated
  # every update through `through_update_id`, and drop those rows once they are
  # older than COMPACTION_GRACE. Updates that raced in with higher ids survive,
  # as do ones too young to be safely claimed -- merges are commutative, so
  # snapshot + surviving rows still yields the current document.
  def update
    doc = @project.project_doc
    return head :conflict if doc.nil?

    through_id = params.require(:through_update_id).to_i
    ActiveRecord::Base.transaction do
      doc.update!(snapshot: decoded_snapshot)
      @project.project_doc_updates
        .where(id: ..through_id)
        .where(created_at: ...COMPACTION_GRACE.ago)
        .delete_all
    end
    head :no_content
  end

  private

  def set_project
    @project = Project.find(params[:id])
    # Anyone who can edit the project can carry its collaborative doc.
    authorize! :update, @project
  end

  def decoded_snapshot
    Base64.strict_decode64(params.require(:snapshot))
  end
end
