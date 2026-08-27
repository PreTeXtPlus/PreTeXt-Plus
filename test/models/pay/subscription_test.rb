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

  test "invoiced subscription with unpaid invoice does not grant privileges" do
    subscription = pay_subscriptions(:one)
    subscription.object = { "collection_method" => "send_invoice", "latest_invoice" => { "status" => "open" } }
    assert_not subscription.grants_privileges?
  end

  test "invoiced subscription with paid invoice grants privileges" do
    subscription = pay_subscriptions(:one)
    subscription.object = { "collection_method" => "send_invoice", "latest_invoice" => { "status" => "paid" } }
    assert subscription.grants_privileges?
  end

  test "non-invoiced active subscription grants privileges regardless of latest_invoice" do
    subscription = pay_subscriptions(:one)
    subscription.object = { "collection_method" => "charge_automatically", "latest_invoice" => { "status" => "open" } }
    assert subscription.grants_privileges?
  end
end
