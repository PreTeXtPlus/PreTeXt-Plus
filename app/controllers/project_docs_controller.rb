# HTTP persistence for a project's collaborative Yjs document. All payloads
# are opaque binary carried as base64 in JSON; the CRDT semantics live
# entirely in the clients. Live update relay is ProjectDocChannel; these
# endpoints only cover joining (show), first-time seeding (seed), and
# compaction (update).
class ProjectDocsController < ApplicationController
  before_action :set_project

  # The most rows one compaction may name. Matches the client's own cap on the
  # set it tracks (yCableProvider's MAX_TRACKED_UPDATE_IDS); anything beyond it
  # is ignored rather than rejected, since a shorter claim only ever means fewer
  # deletions, and the rows left behind are collected by the next compaction.
  MAX_MERGED_IDS = 10_000

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
  # Compaction: replace the snapshot with a full state, and delete exactly the
  # rows that state was built from -- `merged_update_ids`, named one by one.
  #
  # Deliberately not a range. `project_doc_updates.id` comes from a sequence, and
  # a sequence value is allocated at INSERT, before COMMIT, so a reader ordering
  # by id can pass over a row whose id is lower than one it has already returned.
  # A client asking to delete "everything through N" is therefore asserting
  # something it cannot check, and getting it wrong destroys an update for the
  # whole session: the snapshot replacing the row does not carry it, and by then
  # nothing else does either. A list of ids asserts only what the client actually
  # read, which it does know.
  #
  # Rows that raced in afterwards, and any the client never saw, are simply
  # absent from the list and survive -- merges are commutative, so snapshot plus
  # surviving rows still yields the current document.
  def update
    doc = @project.project_doc
    return head :conflict if doc.nil?

    ActiveRecord::Base.transaction do
      doc.update!(snapshot: decoded_snapshot)
      @project.project_doc_updates.where(id: merged_update_ids).delete_all if merged_update_ids.any?
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

  # A client that sends none is compacting without claiming anything, which is
  # legal and just means the snapshot is refreshed while the log stays put.
  def merged_update_ids
    @merged_update_ids ||=
      Array(params[:merged_update_ids]).first(MAX_MERGED_IDS).map(&:to_i)
  end
end
