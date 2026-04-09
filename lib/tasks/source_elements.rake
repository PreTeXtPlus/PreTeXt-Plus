namespace :source_elements do
  desc "Migrate existing projects from single source field to source_elements"
  task migrate_legacy: :environment do
    migrated = 0
    skipped = 0

    Project.unscoped.find_each do |project|
      if project.source_elements.any?
        skipped += 1
        next
      end

      next if project.source.blank?

      project.source_elements.create!(
        element_type: "section",
        title: project.title.presence || "Main",
        source: project.source,
        pretext_source: project.pretext_source,
        position: 0
      )
      migrated += 1
    end

    puts "Migrated #{migrated} projects, skipped #{skipped} (already have elements)"
  end
end
