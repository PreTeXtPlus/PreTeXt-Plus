namespace :cdn do
  desc "Make already-published single-file targets' current build public, for cdn.pretext.plus"
  task backfill_public_builds: :environment do
    count = 0

    Target.where(published: true).find_each do |target|
      next if target.site? || target.current_build.nil?

      target.make_current_build_public!
      count += 1
    end

    puts "Enqueued #{count} target#{"s" unless count == 1} for publishing to the CDN."
  end
end
