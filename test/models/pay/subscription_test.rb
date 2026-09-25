require "test_helper"

class Pay::SubscriptionTest < ActiveSupport::TestCase
  FakeType = Struct.new(:recurrence)

  test "reminders_enabled? defaults on for an annual plan with no explicit choice" do
    subscription = pay_subscriptions(:one)

    SubscriptionType.stub(:find_by, FakeType.new("year")) do
      assert subscription.reminders_enabled?
    end
  end

  test "reminders_enabled? defaults off for a monthly plan with no explicit choice" do
    subscription = pay_subscriptions(:one)

    SubscriptionType.stub(:find_by, FakeType.new("month")) do
      assert_not subscription.reminders_enabled?
    end
  end

  test "reminders_enabled? is off when the plan type cannot be resolved" do
    subscription = pay_subscriptions(:one)

    SubscriptionType.stub(:find_by, nil) do
      assert_not subscription.reminders_enabled?
    end
  end

  test "reminders_enabled? honors an explicit override over the interval default" do
    subscription = pay_subscriptions(:one)

    subscription.user.update!(subscription_reminders: false)
    SubscriptionType.stub(:find_by, FakeType.new("year")) do
      assert_not subscription.reminders_enabled?
    end

    subscription.user.update!(subscription_reminders: true)
    SubscriptionType.stub(:find_by, FakeType.new("month")) do
      assert subscription.reminders_enabled?
    end
  end

  test "active subscription grants privileges" do
    subscription = pay_subscriptions(:one)
    assert subscription.grants_privileges?
  end

  test "subscribed user is subscribed" do
    user = users(:subscribed)
    assert user.subscribed?
  end

  test "trialing subscription grants privileges until the trial ends" do
    subscription = pay_subscriptions(:one)
    subscription.update_columns(status: "trialing", trial_ends_at: 3.days.from_now)
    assert subscription.on_trial?
    assert subscription.grants_privileges?
    assert users(:subscribed).subscribed?
  end

  test "subscription whose trial ended without payment does not grant privileges" do
    subscription = pay_subscriptions(:one)
    subscription.update_columns(status: "past_due", trial_ends_at: 1.day.ago)
    assert_not subscription.grants_privileges?
    assert_not users(:subscribed).subscribed?
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

  test "invoiced subscription with unpaid invoice grants privileges when user honors invoices" do
    subscription = pay_subscriptions(:one)
    subscription.object = { "collection_method" => "send_invoice", "latest_invoice" => { "status" => "open" } }
    assert !subscription.grants_privileges?
    subscription.user.honor_invoices = true
    assert subscription.grants_privileges?
  end
end
