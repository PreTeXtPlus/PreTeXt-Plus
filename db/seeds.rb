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
  user = User.find_or_initialize_by(email: "admin@example.com")
  user.password = "password123"
  user.password_confirmation = "password123"
  user.admin = true
  user.save!
  puts "Dev admin: admin@example.com / password123"
end
