# Operator tools for collaborative documents. docs/collab-repair.md is the
# runbook (when to look, how to read the report, what not to do); see
# ProjectDocRepair for the procedure and why it is the only way to purge a bad
# entry from a document.
namespace :collab do
  desc "Report what repairing a project's collaborative document would do; with APPLY=1, do it"
  task :repair, [ :project_id ] => :environment do |_task, args|
    project = Project.find(args.fetch(:project_id))
    repair = ProjectDocRepair.new(project)
    report = repair.report
    puts repair.render(report)

    if report.nil?
      # nothing to do
    elsif ENV["APPLY"] == "1"
      repair.apply!
      puts "Repaired: rows projected, document reset, #{report[:users].size} user(s) disconnected. " \
           "The next tab to open the project seeds a fresh document from the rows."
    else
      puts "Dry run; nothing changed. Re-run with APPLY=1 to repair."
    end
  end

  desc "List every collaborative project whose rows do not match its document, or whose last projection skipped a record"
  task scan: :environment do
    keys = Y::Document.where("key LIKE 'project/%/doc'").pluck(:key)
    projects = Project.where(id: keys.filter_map { |key| ProjectDoc.project_id_from(key) })
    stuck = projects.filter_map do |project|
      report = ProjectDocRepair.new(project).report
      next if report.nil? || (report[:issues].empty? && report[:differing_rows].empty?)

      "#{project.id} #{project.title.inspect}: #{report[:issues].size} issue(s), #{report[:differing_rows].size} differing row(s)"
    end
    puts stuck.empty? ? "[]" : stuck
  end
end
