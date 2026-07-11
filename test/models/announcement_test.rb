require "test_helper"

class AnnouncementTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  test "valid with title and body" do
    announcement = Announcement.new(title: "Hello", body: "World")
    assert announcement.valid?
  end

  test "invalid without title" do
    announcement = Announcement.new(body: "Body only")
    assert_not announcement.valid?
    assert_includes announcement.errors[:title], "can't be blank"
  end

  test "invalid without body" do
    announcement = Announcement.new(title: "Title only")
    assert_not announcement.valid?
    assert_includes announcement.errors[:body], "can't be blank"
  end

  test "published? returns true when published_at is set" do
    assert announcements(:published).published?
  end

  test "published? returns false when published_at is nil" do
    assert_not announcements(:draft).published?
  end

  test "published scope excludes drafts" do
    assert_not_includes Announcement.published, announcements(:draft)
  end

  test "published scope includes published announcements" do
    assert_includes Announcement.published, announcements(:published)
  end

  test "published scope orders by published_at descending" do
    results = Announcement.published.to_a
    assert_equal results.sort_by { |a| -a.published_at.to_i }, results
  end

  test "publish! sets published_at" do
    freeze_time do
      announcements(:draft).publish!
      assert_in_delta Time.current.to_i, announcements(:draft).reload.published_at.to_i, 1
    end
  end

  test "publish! enqueues BroadcastAnnouncementJob" do
    announcement = announcements(:draft)
    assert_enqueued_with(job: BroadcastAnnouncementJob, args: [ announcement ]) do
      announcement.publish!
    end
  end

  test "new announcements default to draft" do
    assert Announcement.new(title: "Hello", body: "World").draft?
  end

  test "publish! raises for draft announcements" do
    assert_raises(RuntimeError) do
      announcements(:unready).publish!
    end
    assert_not announcements(:unready).reload.published?
  end
end
