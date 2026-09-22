# frozen_string_literal: true

# Seeding for a project's collaborative document. One endpoint, because the
# server now speaks the sync protocol itself: joining, catching up and
# compaction all happen over ProjectDocChannel, against a document the server
# holds rather than a log browsers had to interpret.
#
# What remains is the one thing the protocol cannot do, because it is a
# question about the project rather than about the document: a brand-new
# session has to decide what the document's *first* content is, and only one
# client may decide it.
class ProjectDocsController < ApplicationController
  before_action :set_project

  # POST /projects/:id/doc/seed
  #
  # Compare-and-set creation. Two clients each seeding a fresh document and
  # then syncing would duplicate every division's text -- the CRDT is right to
  # treat two independent seeds as concurrent inserts -- so exactly one seed
  # wins and the rest are told to join instead.
  #
  # The winner does not apply its own seed locally; it connects, and the
  # handshake hands the document back. That keeps one path into the document
  # for every client, seeder included, instead of a second one that has to stay
  # byte-identical to the first.
  def seed
    if ProjectDoc.seed(@project, decoded_state)
      head :created
    else
      head :conflict
    end
  end

  private

  def set_project
    @project = Project.find(params[:id])
    # Anyone who can edit the project can carry its collaborative doc.
    authorize! :update, @project
  end

  def decoded_state
    Base64.strict_decode64(params.require(:state))
  end
end
