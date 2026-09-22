# frozen_string_literal: true

# Write a project's collaborative document out into its ordinary records.
#
# The document is the session's truth while anyone is editing; these rows are
# the view of it that everything outside the editor reads. Projecting used to be
# a browser's job -- one tab elected by the session ran a ten-second autosave on
# everyone's behalf, which is how an idle collaborator's window came to overwrite
# source a build had just consumed. The server holds the document now
# (ProjectDocChannel), so it can do this itself, from state it knows to be
# current rather than from one client's copy of it.
#
# Idempotent by construction: it derives everything from the document and writes
# the same rows given the same document, so it is safe to run on a timer, before
# a build, or twice at once.
#
# NOTE: this deliberately does not write `Project#pretext_source`, the assembled
# standalone document the build server consumes. Assembling it resolves
# <plus:* ref="..."/> placeholders and converts latex/markdown divisions, and
# that logic lives in JavaScript (assembleFullProjectSource). Until it can be
# reached from here, the editor still writes that column and this covers
# everything else.
class ProjectDocProjection
  # Tombstones are never cleared from the document, because yrby's Ruby bindings
  # can read a document but not write one. That is cheap and safe: a delete is
  # idempotent, so re-sending one costs nothing, and the map grows by one short
  # entry per record ever removed.
  DELETABLE_KINDS = %w[ division asset snippet ].freeze

  def initialize(project)
    @project = project
  end

  # @return [Boolean] false when there is no document to project.
  def apply!
    state = ProjectDoc.load_state(ProjectDoc.key_for(@project))
    return false if state.nil?

    doc = Y::Doc.new
    doc.apply_update(state)
    @project.update!(attributes_from(doc))
    true
  end

  private

  def attributes_from(doc)
    meta = read_map(doc, "meta")
    deleted = read_map(doc, "deleted")

    attributes = {
      title: meta["title"].to_s,
      docinfo: meta["docinfo"].to_s,
      divisions_attributes: division_attributes(doc, deleted)
    }
    # Absent from the document is not the same as false or blank: a document
    # seeded before either field existed simply has nothing to say about them,
    # and must not reset the project's own value.
    attributes[:use_common_docinfo] = meta["useCommonDocinfo"] unless meta["useCommonDocinfo"].nil?
    attributes[:language] = meta["language"] unless meta["language"].nil?

    destroys = destroy_attributes(deleted, "asset")
    attributes[:assets_attributes] = destroys if destroys.any?
    destroys = destroy_attributes(deleted, "snippet")
    attributes[:snippets_attributes] = destroys if destroys.any?

    attributes
  end

  # `is_root` is deliberately absent, as it is from the editor's own payload: a
  # projection must never move which division is the root.
  def division_attributes(doc, deleted)
    present = read_map(doc, "divisions").filter_map do |id, entry|
      next if deleted[id] == "division" # removed in the same session that wrote it

      {
        id: id,
        ref: entry["xmlId"].to_s,
        source: entry["source"].to_s,
        source_format: entry["sourceFormat"].presence || "pretext"
      }
    end
    present + destroy_attributes(deleted, "division")
  end

  # Rails drops a `_destroy` naming a row that is already gone, which is what
  # lets a tombstone stay in the document forever without costing anything.
  def destroy_attributes(deleted, kind)
    deleted.filter_map { |id, k| { id: id, _destroy: true } if k == kind }
  end

  # A root map that has never been written does not exist in the document, and
  # yrby reports that as nil rather than as an empty map.
  def read_map(doc, name)
    JSON.parse(doc.read_map(name) || "{}")
  end
end
