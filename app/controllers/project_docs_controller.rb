# HTTP persistence for a project's collaborative Yjs document. All payloads
# are opaque binary carried as base64 in JSON; the CRDT semantics live
# entirely in the clients. Live update relay is ProjectDocChannel; these
# endpoints only cover joining (show), first-time seeding (seed), and
# compaction (update).
class ProjectDocsController < ApplicationController
  before_action :set_project

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
  # every update through `through_update_id`, and drop those rows. Updates
  # that raced in with higher ids survive -- merges are commutative, so
  # snapshot + surviving rows still yields the current document.
  def update
    doc = @project.project_doc
    return head :conflict if doc.nil?

    through_id = params.require(:through_update_id).to_i
    ActiveRecord::Base.transaction do
      doc.update!(snapshot: decoded_snapshot)
      @project.project_doc_updates.where(id: ..through_id).delete_all
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
