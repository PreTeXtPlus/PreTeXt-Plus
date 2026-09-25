# frozen_string_literal: true

# The two things a client still asks of a project's collaborative document over
# HTTP. Everything about the document itself -- joining, catching up,
# compaction -- happens over ProjectDocChannel, against a document the server
# holds rather than a log browsers had to interpret.
#
# What is left here are the two questions that are about the *project* rather
# than about the document: what the document's first content should be, and
# when the project's rows should be made to agree with it.
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

  # POST /projects/:id/doc/flush
  #
  # Write the document out into the project's rows, now, and do not return until
  # it is done. ProjectDocProjectionJob does this on a timer for readers who did
  # not ask; this is for the author who did -- saving and closing, or copying the
  # project -- and is about to look at, or duplicate, those rows.
  #
  # The browser no longer writes them itself, so without this the editor would
  # have no way to make "Save" mean anything: a copy taken straight afterwards
  # would be built from whatever the last scheduled run left behind.
  #
  # Idempotent, and cheap enough to be worth no cleverness: ~15ms to read the
  # document and write the rows it implies. An exception is deliberately not
  # rescued -- the client needs to hear that the save did not happen, rather
  # than navigate away believing it did.
  def flush
    ProjectDocProjection.new(@project).apply!
    head :no_content
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
