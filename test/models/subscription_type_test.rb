require "test_helper"

class SubscriptionTypeTest < ActiveSupport::TestCase
  test "trial_days defaults to no trial" do
    assert_equal 0, SubscriptionType.new.trial_days
  end

  test "trial_days accepts 0 and a positive number of days" do
    assert SubscriptionType.new(name: "Free", trial_days: 0).valid?
    assert SubscriptionType.new(name: "Paid", trial_days: 7).valid?
  end

  test "trial_days rejects negative, fractional, and over-long trials" do
    [ -1, 1.5, 731 ].each do |days|
      subscription_type = SubscriptionType.new(name: "Bad", trial_days: days)
      assert_not subscription_type.valid?, "expected #{days} to be rejected"
      assert subscription_type.errors[:trial_days].any?
    end
  end

  test "trial_days_for gives the full trial to a user with no subscriptions" do
    assert_equal 7, subscription_types(:two).trial_days_for(users(:one))
  end

  test "trial_days_for gives no trial to a user who has already subscribed" do
    assert_equal 0, subscription_types(:two).trial_days_for(users(:subscribed))
  end

  test "trial_days_for gives no trial when the plan has none" do
    subscription_type = subscription_types(:two)
    subscription_type.trial_days = 0

    assert_equal 0, subscription_type.trial_days_for(users(:one))
  end
end
