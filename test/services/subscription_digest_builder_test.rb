require "test_helper"

class SubscriptionDigestBuilderTest < ActiveSupport::TestCase
  def customer
    pay_customers(:one)
  end

  def subscription
    pay_subscriptions(:one)
  end

  def create_charge(billing_reason:, created_at:, subscription: self.subscription)
    Pay::Stripe::Charge.create!(
      customer: customer,
      subscription: subscription,
      processor_id: "ch_#{SecureRandom.hex(6)}",
      amount: 999,
      currency: "usd",
      created_at: created_at,
      data: { "stripe_invoice" => { "billing_reason" => billing_reason } }
    )
  end

  test "includes a subscription whose charge in the window is a new subscription" do
    create_charge(billing_reason: "subscription_create", created_at: 1.hour.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert_equal [ subscription ], result.new_subscriptions.map(&:subscription)
    assert_empty result.canceled_subscriptions
  end

  test "excludes a renewal charge in the window" do
    create_charge(billing_reason: "subscription_create", created_at: 40.days.ago)
    create_charge(billing_reason: "subscription_cycle", created_at: 1.hour.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert result.empty?
  end

  test "includes a trial converting, whose first charge is a subscription_cycle" do
    create_charge(billing_reason: "subscription_cycle", created_at: 1.hour.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert_equal [ subscription ], result.new_subscriptions.map(&:subscription)
  end

  test "excludes the renewal after a converted trial" do
    create_charge(billing_reason: "subscription_cycle", created_at: 30.days.ago)
    create_charge(billing_reason: "subscription_cycle", created_at: 1.hour.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert result.empty?
  end

  test "excludes a new-subscription charge outside the window" do
    create_charge(billing_reason: "subscription_create", created_at: 2.days.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert result.empty?
  end

  test "includes a canceled, previously-paying subscription" do
    create_charge(billing_reason: "subscription_create", created_at: 2.days.ago)
    subscription.update_columns(status: "canceled", updated_at: 1.hour.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert_equal [ subscription ], result.canceled_subscriptions.map(&:subscription)
    assert_empty result.new_subscriptions
  end

  test "excludes a canceled subscription that was never charged" do
    subscription.update_columns(status: "canceled", updated_at: 1.hour.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert result.empty?
  end

  test "excludes a canceled subscription outside the window" do
    create_charge(billing_reason: "subscription_create", created_at: 2.days.ago)
    subscription.update_columns(status: "canceled", updated_at: 2.days.ago)

    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert result.empty?
  end

  test "result is empty when nothing qualifies" do
    result = SubscriptionDigestBuilder.new(since: 24.hours.ago).build

    assert result.empty?
  end
end
