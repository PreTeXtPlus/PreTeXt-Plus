require "test_helper"

class Pay::SubscriptionTest < ActiveSupport::TestCase
  test "active subscription grants privileges" do
    subscription = pay_subscriptions(:one)
    assert subscription.grants_privileges?
  end

  test "subscribed user is subscribed" do
    user = users(:subscribed)
    assert user.subscribed?
  end
end
