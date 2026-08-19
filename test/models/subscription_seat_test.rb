require "test_helper"

class SubscriptionSeatTest < ActiveSupport::TestCase
  test "a subscription with an unfulfilled invoice does not grant privileges" do
    subscription = pay_subscriptions(:one)
    subscription.update!(status: "past_due")

    assert_not subscription_seats(:one).grants_privileges?
    assert_not users(:subscribed).subscribed?
  end
end
