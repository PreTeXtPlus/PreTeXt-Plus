require "test_helper"

class UnconfirmedAccountCleanupJobTest < ActiveJob::TestCase
  setup do
    @user = users(:unconfirmed)
    @user.update_columns(created_at: (User::UNCONFIRMED_RETENTION + 1.hour).ago)
  end

  test "deletes an unconfirmed, empty account once the retention period has passed" do
    UnconfirmedAccountCleanupJob.perform_now

    assert_not User.exists?(@user.id)
  end

  test "deletes nobody else" do
    assert_difference "User.count", -1 do
      UnconfirmedAccountCleanupJob.perform_now
    end
  end

  test "leaves a recent sign-up alone" do
    @user.update_columns(created_at: (User::UNCONFIRMED_RETENTION - 1.hour).ago)

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end

  test "leaves a confirmed account alone, however empty" do
    @user.update_columns(confirmed_at: Time.current)

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end

  test "leaves an account with a project alone" do
    Project.create!(user: @user, title: "Mine")

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end

  test "leaves a collaborator on someone else's project alone" do
    Collaboration.create!(project: projects(:two), user: @user, invited_email: @user.email, accepted_at: Time.current)

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end

  test "leaves an account holding a subscription seat alone" do
    SubscriptionSeat.create!(user: @user, pay_subscription_id: subscription_seats(:one).pay_subscription_id)

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end

  test "leaves an account with a billing record alone" do
    @user.set_payment_processor(:fake_processor, allow_fake: true)

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end

  test "leaves an admin alone" do
    @user.update_columns(admin: true)

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end

  test "leaves an account already pending deletion to AccountPurgeJob" do
    @user.update_columns(deletion_requested_at: 1.hour.ago)

    UnconfirmedAccountCleanupJob.perform_now

    assert User.exists?(@user.id)
  end
end
