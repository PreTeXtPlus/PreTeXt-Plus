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
# It does not write the assembled standalone document a build consumes. Nothing
# does: the old column is no longer read or written. SourceAssembler builds the
# document from these rows when a build asks, which is why FullBuildJob runs
# this first -- see the comment there for what that ordering buys.
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
    divisions = read_map(doc, "divisions")
    snippets = read_map(doc, "snippets")
    assets = read_map(doc, "assets")

    attributes = {
      title: meta["title"].to_s,
      docinfo: meta["docinfo"].to_s,
      divisions_attributes: division_attributes(divisions, deleted)
    }
    # Absent from the document is not the same as false or blank: a document
    # seeded before either field existed simply has nothing to say about them,
    # and must not reset the project's own value.
    attributes[:use_common_docinfo] = meta["useCommonDocinfo"] unless meta["useCommonDocinfo"].nil?
    attributes[:language] = meta["language"] unless meta["language"].nil?

    rows = asset_attributes(assets, deleted)
    attributes[:assets_attributes] = rows if rows.any?
    rows = snippet_attributes(snippets, deleted)
    attributes[:snippets_attributes] = rows if rows.any?

    attributes
  end

  # `is_root` is deliberately absent, as it is from the editor's own payload: a
  # projection must never move which division is the root.
  #
  # The fields a division's element is built from are projected only when the
  # entry carries them -- an entry written before one of them existed has
  # nothing to say about it, and must not blank the column.
  def division_attributes(divisions, deleted)
    present = divisions.filter_map do |id, entry|
      next if deleted[id] == "division" # removed in the same session that wrote it

      attributes = {
        id: id,
        ref: entry["xmlId"].to_s,
        source: entry["source"].to_s,
        source_format: entry["sourceFormat"].presence || "pretext"
      }
      attributes[:title] = entry["title"].to_s if entry.key?("title")
      attributes[:division_type] = entry["type"] if entry["type"].present?
      attributes[:attrs] = entry["attrs"] if entry["attrs"].is_a?(Hash)
      attributes
    end
    present + destroy_attributes(deleted, "division")
  end

  # A snippet's source is shared text in the document exactly like a division's,
  # so it is projected the same way. Its id may be one the editor minted and the
  # host has not stored yet; Project#snippets_attributes= creates that row.
  def snippet_attributes(snippets, deleted)
    present = snippets.filter_map do |id, entry|
      next if deleted[id] == "snippet"

      attributes = {
        id: id,
        ref: entry["ref"].to_s,
        source: entry["source"].to_s,
        source_format: entry["sourceFormat"].presence || "pretext"
      }
      # Absent from an entry written before snippets had titles; not a blank one.
      attributes[:title] = entry["title"].to_s if entry.key?("title")
      attributes
    end
    present + destroy_attributes(deleted, "snippet")
  end

  # An asset's text -- its source, title, id and alt text -- is projected like a
  # snippet's, but only onto an asset the project already has. The row is always
  # created by its upload (the file has to exist first), and the uploader only
  # publishes the entry once that has happened; an entry naming an asset this
  # project lacks is one whose upload never landed, and projecting it would build
  # a fileless asset out of nothing.
  def asset_attributes(assets, deleted)
    known = @project.assets.pluck(:id).map(&:to_s).to_set
    present = assets.filter_map do |id, entry|
      next if deleted[id] == "asset" || !known.include?(id)

      {
        id: id,
        ref: entry["ref"].to_s,
        title: entry["title"].to_s,
        source: entry["source"].to_s,
        short_description: entry["shortDescription"].to_s
      }
    end
    present + destroy_attributes(deleted, "asset")
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
