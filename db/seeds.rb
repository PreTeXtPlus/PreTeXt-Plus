# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
# Example:
#
#   ["Action", "Comedy", "Drama", "Horror"].each do |genre_name|
#     MovieGenre.find_or_create_by!(name: genre_name)
#   end

# Development admin user — run `bin/rails db:seed` to (re)create
if Rails.env.development?
  Rake::Task["db:fixtures:load"].invoke

  # Fixture builds are inserted straight into the DB, bypassing FullBuildJob, so nothing
  # ever resolves them and BuildWatchdogJob only runs in production (config/recurring.yml)
  # -- left alone, a freshly seeded dev environment shows a Building pill that never
  # clears. Cancel them the same way the UI's Cancel button would.
  Build.where(status: Build.statuses.values_at(*Target::UNRESOLVED)).find_each do |build|
    BuildCanceller.new(build).cancel!
  end

  user = User.find_or_initialize_by(email: "admin@example.com")
  user.password = "password123"
  user.admin = true
  user.skip_confirmation!
  user.save!
  puts "Dev admin: admin@example.com / password123"
end
