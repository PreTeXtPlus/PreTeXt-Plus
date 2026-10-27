require "test_helper"

class MaintenanceWindowTest < ActiveSupport::TestCase
  test "invalid without starts_at" do
    window = MaintenanceWindow.new
    assert_not window.valid?
    assert_includes window.errors[:starts_at], "can't be blank"
  end

  test "upcoming lists future windows" do
    assert_equal [ maintenance_windows(:upcoming) ], MaintenanceWindow.upcoming.to_a
  end

  test "imminent is nil when no window starts within the warning period" do
    assert_nil MaintenanceWindow.imminent
  end

  test "imminent is the soonest window within the warning period" do
    later = MaintenanceWindow.create!(starts_at: 30.hours.from_now)
    sooner = MaintenanceWindow.create!(starts_at: 2.hours.from_now)
    assert_equal sooner, MaintenanceWindow.imminent
    sooner.destroy
    assert_equal later, MaintenanceWindow.imminent
  end

  test "imminent ignores windows that have already started" do
    MaintenanceWindow.create!(starts_at: 5.minutes.ago)
    assert_nil MaintenanceWindow.imminent
  end
end
