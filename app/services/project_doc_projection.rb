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
# Tolerant by construction, too. The document accepts any write, and twice in
# production one malformed entry -- an asset emptied to `{source: ""}`, a
# division whose xml:id held a space -- made the single nested-attributes save
# this used to be raise, which rolled back *every* record and left the project's
# rows silently frozen for a day while the editor kept showing the edits. So
# this is a planner first: it decides per record what can be written, writes
# that in an order the uniqueness rules allow, and records what it had to leave
# out on the project (`projection_issues`), where the editor, the build log and
# the repair task can read it. One bad record costs that record only.
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
  DELETABLE_KINDS = %w[ division asset snippet exercise ].freeze

  # The four record maps, with the nested-attributes collection each projects
  # into and the key its entry keeps the ref under (a division's is its xml:id).
  KINDS = {
    "division" => { map: "divisions", collection: :divisions_attributes, ref_key: "xmlId" },
    "snippet" => { map: "snippets", collection: :snippets_attributes, ref_key: "ref" },
    "exercise" => { map: "exercises", collection: :exercises_attributes, ref_key: "ref" },
    "asset" => { map: "assets", collection: :assets_attributes, ref_key: "ref" }
  }.freeze

  # Where a row whose ref is wanted by another record waits while the two trade
  # places (see #free_refs!). Matches REF_REGEX, so the row stays valid there.
  def self.parking_ref(id)
    "tmp_#{id.to_s.delete('-').first(8)}"
  end

  # How a projection issue's reason names the record that already holds an ID.
  ISSUE_KIND_NAMES = {
    "division" => "division",
    "asset" => "image",
    "snippet" => "snippet",
    "exercise" => "exercise"
  }.freeze

  INVALID_REF_REASON = "Its ID isn't valid. IDs start with a letter and use only letters, numbers, - and _"

  Candidate = Struct.new(:kind, :id, :ref, :attributes, keyword_init: true)

  # What this projection left out, as `{kind, id, ref, reason}` hashes, sorted
  # so the same document always yields the same list. Also written to the
  # project as `projection_issues`.
  attr_reader :issues

  def initialize(project)
    @project = project
    @issues = []
  end

  # @return [Boolean] false when there is no document to project.
  def apply!
    state = ProjectDoc.load_state(ProjectDoc.key_for(@project))
    if state.nil?
      # Without a document nothing can be stuck behind one: the rows are the
      # only truth there is, so issues recorded against a document since reset
      # no longer describe anything.
      @project.update_columns(projection_issues: []) if @project.projection_issues.present?
      return false
    end

    doc = Y::Doc.new
    doc.apply_update(state)
    had_issues = @project.projection_issues.present?

    Project.transaction do
      write!(doc)
      @issues.sort_by! { |issue| [ issue["kind"], issue["id"] ] }
      @project.update_columns(projection_issues: @issues, projection_checked_at: Time.current)
    end

    # Once per transition from healthy to not, rather than once per run: the
    # job runs every minute, and the point is to learn the project is stuck,
    # not to be told again each minute until someone repairs it.
    report_issues if @issues.any? && !had_issues
    true
  end

  # Everything #apply! would decide, without writing any of it: the records it
  # would write (`candidates`, each with the attributes its row would get), the
  # rows it would destroy, the issues it would record, and the document's maps
  # as read. For ProjectDocRepair, whose report has to say what a repair will
  # do before it does it. nil when there is no document.
  #
  # One difference from a real run: a record refused by a validation only its
  # row knows about (see #write_rows!) is listed here as a candidate, since
  # finding out means attempting the save.
  def preview
    state = ProjectDoc.load_state(ProjectDoc.key_for(@project))
    return nil if state.nil?

    doc = Y::Doc.new
    doc.apply_update(state)
    @issues = []
    planned = plan(doc)
    @issues.sort_by! { |issue| [ issue["kind"], issue["id"] ] }
    planned.merge(issues: @issues)
  end

  private

  def write!(doc)
    planned = plan(doc)
    candidates = planned[:candidates]
    destroyed = planned[:destroyed]
    existing = planned[:existing]
    destroyed_ids = destroyed.map(&:last).to_set

    # Three phases, because refs are unique per project (the Content validator
    # and index_contents_on_project_id_and_ref, which cannot be deferred) and a
    # single save validates every record before it writes any. Removing a
    # record and recreating its ref, or swapping two refs, are both legal
    # edits whose rows would each be refused as "already taken" if written in
    # one go.
    destroy_rows!(destroyed) if destroyed.any?
    parked = free_refs!(candidates, existing, destroyed_ids)
    written = write_rows!(planned[:meta], candidates)
    unpark!(parked - written, existing)
  end

  # Read the document and decide, record by record, what can be written.
  def plan(doc)
    maps = %w[ meta deleted divisions snippets exercises assets ].to_h { |name| [ name, read_map(doc, name) ] }
    existing = existing_rows

    candidates = KINDS.flat_map do |kind, spec|
      candidates_for(kind, spec, maps[spec[:map]], maps["deleted"], existing)
    end
    destroyed = tombstones(maps["deleted"], existing)
    candidates = settle_refs(candidates, existing, destroyed.map(&:last).to_set)

    { maps: maps, meta: maps["meta"], existing: existing, candidates: candidates, destroyed: destroyed }
  end

  # Every row the project has, by id: its ref, and its kind in the document's
  # vocabulary (both asset kinds are "asset" there).
  def existing_rows
    @project.contents.pluck(:id, :ref, :kind).to_h do |id, ref, kind|
      [ id.to_s, { ref: ref, kind: Content::ASSET_KINDS.include?(kind) ? "asset" : kind } ]
    end
  end

  # The entries of one map that can be written at all. A malformed entry --
  # no ref, or one REF_REGEX refuses -- is skipped *whole*: its row keeps every
  # field it has. Projecting the fields around a bad ref is what blanked an
  # asset's title during the first incident's recovery.
  def candidates_for(kind, spec, entries, deleted, existing)
    entries.filter_map do |id, entry|
      next if deleted[id] == kind # removed in the same session that wrote it

      row = existing[id]
      # An asset's text is projected only onto an asset the project already
      # has. The row is always created by its upload (the file has to exist
      # first), and the uploader only publishes the entry once that has
      # happened; an entry naming an asset this project lacks is one whose
      # upload never landed, and projecting it would build a fileless asset
      # out of nothing.
      next if kind == "asset" && row.nil?
      if row && row[:kind] != kind
        issue!(kind, id, nil, "It clashes with another item in this project. Please email support@pretext.plus",
               detail: "id belongs to a #{row[:kind]}")
        next
      end

      ref = entry[spec[:ref_key]].to_s
      if ref.empty?
        issue!(kind, id, nil, "It needs an ID", detail: "ref is missing")
        next
      end
      unless REF_REGEX.match?(ref)
        issue!(kind, id, ref, INVALID_REF_REASON, detail: "ref #{ref.truncate(60).inspect} is invalid")
        next
      end

      Candidate.new(kind: kind, id: id, ref: ref, attributes: send(:"#{kind}_attributes", id, entry))
    end
  end

  # Tombstones naming a row the project still has. Rails drops a `_destroy`
  # for a row that is already gone, but there is no need to send one.
  def tombstones(deleted, existing)
    deleted.filter_map do |id, kind|
      [ kind, id ] if DELETABLE_KINDS.include?(kind) && existing.dig(id, :kind) == kind
    end
  end

  # Settle who gets each ref, since the document cannot: a CRDT has no way to
  # refuse the second of two collaborators who name a record the same thing at
  # the same moment, so by the time it reaches us both entries exist. A row the
  # document leaves alone keeps its ref. Otherwise the row that already holds
  # the ref keeps it, then an existing row beats a new one, then the lowest id
  # wins -- so every projection of the same document reaches the same answer.
  # Losers are skipped; a placeholder naming the ref still resolves, to the
  # winner.
  def settle_refs(candidates, existing, destroyed_ids)
    named = candidates.map(&:id).to_set | destroyed_ids
    held = existing.each_with_object({}) do |(id, row), refs|
      refs[row[:ref]] = id unless named.include?(id)
    end

    candidates.group_by(&:ref).flat_map do |ref, group|
      if (holder = held[ref])
        group.each do |c|
          issue!(c.kind, c.id, ref, ref_taken_reason(existing[holder][:kind]),
                 detail: "ref is already used by #{existing[holder][:kind]} #{holder}")
        end
        next []
      end
      next group if group.one?

      winner = group.min_by do |c|
        [ existing.dig(c.id, :ref) == ref ? 0 : 1, existing.key?(c.id) ? 0 : 1, c.id ]
      end
      (group - [ winner ]).each do |c|
        issue!(c.kind, c.id, ref, ref_taken_reason(winner.kind), detail: "ref is already used by #{winner.kind} #{winner.id}")
      end
      [ winner ]
    end
  end

  def destroy_rows!(destroyed)
    attributes = Hash.new { |h, k| h[k] = [] }
    destroyed.each { |kind, id| attributes[KINDS[kind][:collection]] << { id: id, _destroy: true } }
    @project.update!(attributes)
  end

  # Move every row whose current ref another record is about to take to a
  # parking ref first. After this no record's final ref is held by anyone else,
  # so the main save cannot be refused for a ref that is only passing through.
  # Only renames that actually block someone are parked; a plain rename costs
  # one write, as before.
  #
  # @return [Set<String>] the ids parked, which #unpark! needs if one of them
  #   then turns out not to be writable.
  def free_refs!(candidates, existing, destroyed_ids)
    wanted = candidates.to_h { |c| [ c.ref, c.id ] }
    blocking = existing.filter_map do |id, row|
      next if destroyed_ids.include?(id)

      wanter = wanted[row[:ref]]
      [ row[:kind], id ] if wanter && wanter != id
    end
    return Set.new if blocking.empty?

    attributes = Hash.new { |h, k| h[k] = [] }
    blocking.each { |kind, id| attributes[KINDS[kind][:collection]] << { id: id, ref: self.class.parking_ref(id) } }
    @project.update!(attributes)
    blocking.map(&:last).to_set
  end

  # The main save: the project's own fields and every record that survived
  # planning, in one nested-attributes update. The planner has settled every
  # ref, but a record can still be refused for reasons only its validations
  # know (a root whose type is not a root element, say). Validation runs over
  # every record before anything is written, so when it refuses, the records it
  # refused are known and nothing has happened yet: list them, drop them, and
  # save the rest.
  #
  # @return [Set<String>] the ids written.
  def write_rows!(meta, candidates)
    loop do
      @project.update!(row_attributes(meta, candidates))
      return candidates.map(&:id).to_set
    rescue ActiveRecord::RecordInvalid
      invalid = invalid_records
      raise if invalid.empty? # the project itself, not one of its records

      invalid.each do |record|
        issue!(document_kind(record), record.id.to_s, record.ref, validation_reason(record),
               detail: record.errors.full_messages.to_sentence)
      end
      refused = invalid.map { |record| record.id.to_s }.to_set
      candidates = candidates.reject { |c| refused.include?(c.id) }
      @project.reload # forget the refused assignments along with the rest
    end
  end

  def row_attributes(meta, candidates)
    attributes = {
      title: meta["title"].to_s,
      docinfo: meta["docinfo"].to_s
    }
    # Absent from the document is not the same as false or blank: a document
    # seeded before either field existed simply has nothing to say about them,
    # and must not reset the project's own value.
    attributes[:use_common_docinfo] = meta["useCommonDocinfo"] unless meta["useCommonDocinfo"].nil?
    attributes[:language] = meta["language"] unless meta["language"].nil?

    candidates.group_by { |c| KINDS[c.kind][:collection] }.each do |collection, group|
      attributes[collection] = group.map(&:attributes)
    end
    attributes
  end

  # After a failed nested save every record that was validated still carries
  # its own errors; the ones that have any are the ones that were refused.
  def invalid_records
    %i[ divisions snippets exercises assets ].flat_map do |name|
      @project.association(name).target.select { |record| record.errors.any? }
    end
  end

  # A parked row that was then refused by #write_rows! must not be left at its
  # parking ref. Its old ref is given back if it is free again (the record
  # that wanted it was refused too, or renamed elsewhere); if not, it stays
  # parked and its issue's detail says where it is, for the repair task to settle.
  def unpark!(parked, existing)
    return if parked.empty?

    taken = @project.contents.pluck(:ref).to_set
    parked.each do |id|
      original = existing[id][:ref]
      if taken.include?(original)
        issue = @issues.find { |i| i["id"] == id }
        issue["detail"] = "#{issue['detail']} (parked at #{self.class.parking_ref(id)})" if issue
      else
        Content.where(id: id).update_all(ref: original)
        taken << original
      end
    end
  end

  # `reason` is for the author, who sees it under the project page's and the
  # editor's warning; `detail` keeps the internals (row ids, parking refs) for
  # the log, Honeybadger and the repair report.
  def issue!(kind, id, ref, reason, detail: reason)
    @issues << { "kind" => kind, "id" => id, "ref" => ref, "reason" => reason, "detail" => detail }
  end

  def ref_taken_reason(kind)
    "This ID is already used by another #{ISSUE_KIND_NAMES.fetch(kind.to_s, 'item')}"
  end

  # A row's own validations, in the author's words where the refusal is about
  # its ID, and in the validator's otherwise.
  def validation_reason(record)
    errors = record.errors
    return ref_taken_reason("item") if errors.of_kind?(:ref, :taken)
    return INVALID_REF_REASON if errors.attribute_names == [ :ref ]

    "It can't be saved: #{errors.full_messages.to_sentence}"
  end

  def report_issues
    Honeybadger.notify(
      "Collaborative document has records that cannot be projected",
      error_class: "Collab::ProjectionIssues",
      fingerprint: "projection-#{@project.id}",
      context: { project_id: @project.id, issues: @issues }
    )
    Rails.logger.warn("[collab] projection of project #{@project.id} skipped #{@issues.size} record(s): #{@issues.to_json}")
  end

  def document_kind(record)
    record.asset? ? "asset" : record.kind
  end

  # ---- per-record attributes, from a document entry ----

  # `is_root` is deliberately absent, as it is from the editor's own payload: a
  # projection must never move which division is the root.
  #
  # The fields a division's element is built from are projected only when the
  # entry carries them -- an entry written before one of them existed has
  # nothing to say about it, and must not blank the column.
  def division_attributes(id, entry)
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

  # A snippet's source is shared text in the document exactly like a division's,
  # so it is projected the same way. Its id may be one the editor minted and the
  # host has not stored yet; Project#snippets_attributes= creates that row.
  def snippet_attributes(id, entry)
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

  # An exercise is a snippet whose element, like a division's, is built from its
  # fields: its `source` is the body, and `attrs` the <exercise>'s attributes
  # (for a Doenet activity, the <interactive>'s). An entry with no
  # `sourceFormat` is a PreTeXt one, as every entry was before the field.
  def exercise_attributes(id, entry)
    attributes = { id: id, ref: entry["ref"].to_s, source: entry["source"].to_s }
    attributes[:title] = entry["title"].to_s if entry.key?("title")
    attributes[:source_format] = entry["sourceFormat"].to_s if entry["sourceFormat"].present?
    attributes[:attrs] = entry["attrs"] if entry["attrs"].is_a?(Hash)
    attributes
  end

  # An asset's text -- its source, title, id and alt text -- is projected like a
  # snippet's (see #candidates_for for why only onto a row that exists).
  def asset_attributes(id, entry)
    {
      id: id,
      ref: entry["ref"].to_s,
      title: entry["title"].to_s,
      source: entry["source"].to_s,
      short_description: entry["shortDescription"].to_s
    }
  end

  # A root map that has never been written does not exist in the document, and
  # yrby reports that as nil rather than as an empty map.
  def read_map(doc, name)
    JSON.parse(doc.read_map(name) || "{}")
  end
end
