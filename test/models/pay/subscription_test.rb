require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  test "active subscription is active" do
    subscription = pay_subscriptions(:one)
    assert subscription.active?
  end

  test "subscribed user is subscribed" do
    user = users(:subscribed)
    assert user.subscribed?
  end
end
