require "test_helper"

class AccountPurgeJobTest < ActiveJob::TestCase
  test "deletes an account, and its projects, once the grace period has passed" do
    user = users(:one)
    project_ids = user.projects.pluck(:id)
    assert project_ids.any?
    user.update!(deletion_requested_at: (User::DELETION_GRACE_PERIOD + 1.hour).ago)

    AccountPurgeJob.perform_now

    assert_not User.exists?(user.id)
    assert_empty Project.unscoped.where(id: project_ids)
    assert_empty Collaboration.where(user_id: user.id)
  end

  test "leaves an account alone during the grace period" do
    user = users(:one)
    user.update!(deletion_requested_at: (User::DELETION_GRACE_PERIOD - 1.hour).ago)

    AccountPurgeJob.perform_now

    assert User.exists?(user.id)
  end

  test "leaves active accounts alone" do
    assert_no_difference "User.count" do
      AccountPurgeJob.perform_now
    end
  end

  test "deletes an account holding a subscription seat" do
    user = users(:subscribed)
    pay_subscriptions(:one).update!(status: "canceled", ends_at: 1.day.ago)
    user.update!(deletion_requested_at: (User::DELETION_GRACE_PERIOD + 1.hour).ago)

    AccountPurgeJob.perform_now

    assert_not User.exists?(user.id)
    assert_empty SubscriptionSeat.where(user_id: user.id)
  end
end
