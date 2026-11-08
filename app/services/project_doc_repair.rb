# frozen_string_literal: true

# Repair a collaborative project whose document holds something its rows
# cannot: the console procedure from the November 2026 incidents, as one
# command (`bin/rails "collab:repair[<project_id>]"`), reporting first.
#
# yrby can read a Yjs document but not write one, so a bad entry cannot be
# removed from the document in place. The only way to purge it is to drop the
# document and let the next client reseed it from the rows -- which is exactly
# right once the rows hold everything the document holds that is worth keeping.
# ProjectDocProjection (Layer 2) already gets a stuck project that far: it skips
# the bad entries and writes the rest, so the project builds. What it cannot do
# is make the document agree. This does, in the order the incidents taught:
#
#   1. disconnect everyone editing, so no tab writes between the projection and
#      the reset (a tab would also keep the old document alive by resyncing it);
#   2. project, so the rows are as current as the document;
#   3. check that every surviving record's row now matches the document, and
#      stop before the reset if one does not -- a reset over rows that lag the
#      document is how work gets lost;
#   4. reset the document and clear the recorded issues;
#   5. disconnect again, in case anyone rejoined in between. They reload, and
#      the first tab back seeds a fresh document from the rows.
#
# The report (#report) says what all of that would do: the issues, the rows
# that differ from the document, the users who would be disconnected, and the
# full entry of every record the reset will drop -- so nothing disappears
# unseen, and a record whose text matters can be copied out first.
class ProjectDocRepair
  Abort = Class.new(StandardError)

  # The project's own fields the document carries.
  META_FIELDS = {
    "title" => :title, "docinfo" => :docinfo, "language" => :language, "useCommonDocinfo" => :use_common_docinfo
  }.freeze

  attr_reader :project

  def initialize(project)
    @project = project
  end

  # What a repair would do, or nil when the project has no document.
  def report
    preview = ProjectDocProjection.new(project).preview
    return nil if preview.nil?

    {
      issues: preview[:issues],
      differing_rows: differing_rows(preview),
      dropped_entries: dropped_entries(preview),
      users: users_to_disconnect.map { |user| { id: user.id, email: user.email } }
    }
  end

  # Do it. Raises Abort rather than resetting when the rows cannot be made to
  # agree with the document.
  def apply!
    raise Abort, "project #{project.id} has no collaborative document" if report.nil?

    disconnect_everyone!
    ProjectDocProjection.new(project).apply!

    remaining = differing_rows(ProjectDocProjection.new(project).preview)
    if remaining.any?
      raise Abort, "rows still differ from the document after projecting; not resetting: " \
                   "#{remaining.map { |d| "#{d[:kind]} #{d[:id]} #{d[:field]}" }.join(', ')}"
    end

    ProjectDoc.reset!(project)
    project.update_columns(projection_issues: [])
    disconnect_everyone!
    true
  end

  # The report as the rake task prints it.
  def render(report)
    return "Project #{project.id} has no collaborative document; nothing to repair.\n" if report.nil?

    lines = [ "Project #{project.id} (#{project.title.inspect})" ]
    lines << ""
    lines << "Issues (#{report[:issues].size}):"
    report[:issues].each { |i| lines << "  #{i['kind']} #{i['id']} ref=#{i['ref'].inspect}: #{i['reason']}" }
    lines << "  none" if report[:issues].empty?
    lines << ""
    lines << "Rows that differ from the document (#{report[:differing_rows].size}):"
    report[:differing_rows].each do |d|
      lines << "  #{d[:kind]} #{d[:id]} #{d[:field]}: row=#{d[:row].inspect.truncate(80)} doc=#{d[:doc].inspect.truncate(80)}"
    end
    lines << "  none" if report[:differing_rows].empty?
    lines << ""
    lines << "Entries the reset will drop (#{report[:dropped_entries].size}) -- their full content, so nothing disappears unseen:"
    report[:dropped_entries].each do |e|
      lines << "  #{e[:kind]} #{e[:id]}:"
      lines << "    #{JSON.pretty_generate(e[:entry]).gsub("\n", "\n    ")}"
    end
    lines << "  none" if report[:dropped_entries].empty?
    lines << ""
    lines << "Users who will be disconnected (#{report[:users].size}): #{report[:users].map { |u| u[:email] }.join(', ')}"
    lines.join("\n") + "\n"
  end

  private

    # Every field the projection would write whose row says something else:
    # the project's own fields, each surviving record's columns, and rows a
    # tombstone names. Empty means the rows already say what the document says.
    def differing_rows(preview)
      diffs = []
      META_FIELDS.each do |key, column|
        next unless preview[:meta].key?(key)

        doc_value = preview[:meta][key]
        row_value = project.public_send(column)
        diffs << { kind: "project", id: project.id, field: column.to_s, row: row_value, doc: doc_value } unless same?(row_value, doc_value)
      end

      rows = project.contents.where(id: preview[:candidates].map(&:id)).index_by { |row| row.id.to_s }
      preview[:candidates].each do |candidate|
        row = rows[candidate.id]
        if row.nil?
          diffs << { kind: candidate.kind, id: candidate.id, field: "row", row: nil, doc: candidate.ref }
          next
        end
        candidate.attributes.except(:id).each do |field, doc_value|
          row_value = row.public_send(field)
          next if same?(row_value, doc_value)

          diffs << { kind: candidate.kind, id: candidate.id, field: field.to_s, row: row_value, doc: doc_value }
        end
      end

      preview[:destroyed].each do |kind, id|
        diffs << { kind: kind, id: id, field: "tombstone", row: "present", doc: "deleted" }
      end
      diffs
    end

    # A live entry the rows will not hold once projected: a record the
    # projection skips (it is in the issues) or an asset entry whose upload
    # never landed. These are what the reset loses.
    def dropped_entries(preview)
      kept = preview[:candidates].map(&:id).to_set
      deleted = preview[:maps]["deleted"]
      ProjectDocProjection::KINDS.flat_map do |kind, spec|
        preview[:maps][spec[:map]].filter_map do |id, entry|
          next if deleted[id] == kind || kept.include?(id)

          { kind: kind, id: id, entry: entry }
        end
      end
    end

    def same?(row_value, doc_value)
      return row_value.to_s == doc_value.to_s if row_value.is_a?(String) || doc_value.is_a?(String)

      row_value == doc_value
    end

    def users_to_disconnect
      ([ project.user ] + project.collaborators.to_a).compact.uniq
    end

    # Through the cable, as the console procedure did, so every tab of theirs
    # drops its subscription at once; `reconnect: false` keeps the client from
    # coming straight back and resyncing the document we are about to drop.
    def disconnect_everyone!
      users_to_disconnect.each do |user|
        ActionCable.server.remote_connections.where(current_user: user).disconnect(reconnect: false)
      end
    end
end
