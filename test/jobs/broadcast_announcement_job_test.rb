require "test_helper"

class BroadcastAnnouncementJobTest < ActiveJob::TestCase
  include ActionMailer::TestHelper

  test "sends to all confirmed users for regular announcement" do
    announcement = announcements(:published)
    assert_not announcement.paid_subscribers_only?

    assert_emails 3 do
      BroadcastAnnouncementJob.perform_now(announcement)
    end
  end

  test "sends only to paid subscribers for paid_subscribers_only announcement" do
    announcement = announcements(:published)
    announcement.update!(paid_subscribers_only: true)

    assert_emails 1 do
      BroadcastAnnouncementJob.perform_now(announcement)
    end

    mail = ActionMailer::Base.deliveries.last
    assert_equal [ users(:subscribed).email ], mail.to
  end

  test "does not send to unconfirmed users" do
    announcement = announcements(:published)

    assert_emails 3 do
      BroadcastAnnouncementJob.perform_now(announcement)
    end
  end
end
