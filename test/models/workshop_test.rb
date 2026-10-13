require "test_helper"

class WorkshopTest < ActiveSupport::TestCase
  test "valid with title, start_time, and link" do
    workshop = Workshop.new(title: "Hello", start_time: 1.day.from_now, link: "https://example.com")
    assert workshop.valid?
  end

  test "invalid without title, start_time, or link" do
    workshop = Workshop.new
    assert_not workshop.valid?
    assert_includes workshop.errors[:title], "can't be blank"
    assert_includes workshop.errors[:start_time], "can't be blank"
    assert_includes workshop.errors[:link], "can't be blank"
  end

  test "rejects a non-web link" do
    workshop = Workshop.new(title: "Hello", start_time: 1.day.from_now, link: "javascript:alert(1)")
    assert_not workshop.valid?
    assert_includes workshop.errors[:link], "is invalid"
  end

  test "upcoming lists future workshops soonest first" do
    assert_equal [ workshops(:upcoming), workshops(:later) ], Workshop.upcoming.to_a
  end

  test "past lists past workshops" do
    assert_equal [ workshops(:past) ], Workshop.past.to_a
  end

  test "next_upcoming returns the soonest future workshop" do
    assert_equal workshops(:upcoming), Workshop.next_upcoming
  end

  test "next_upcoming is nil when no workshop is upcoming" do
    Workshop.upcoming.destroy_all
    assert_nil Workshop.next_upcoming
  end
end
