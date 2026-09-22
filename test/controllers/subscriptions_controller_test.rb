require "test_helper"

class SubscriptionsControllerTest < ActionDispatch::IntegrationTest
  test "confirmed users are offered the plan dropdown" do
    pay_subscriptions(:one).update_columns(current_period_end: 20.days.from_now)
    sign_in users(:subscribed)

    get_index

    assert_response :success
    assert_includes response.body, "New Subscription Plan"
    assert_not_includes response.body, "day free trial"
  end

  test "first-time subscribers see the free trial on the card option" do
    sign_in users(:one)

    get_index

    assert_response :success
    assert_includes response.body, "pay by card, 7-day free trial"
  end

  test "unconfirmed users are asked to confirm their email instead of offered plans" do
    user = users(:unconfirmed)
    user.update_columns(confirmation_sent_at: Time.current)
    sign_in user

    get_index

    assert_response :success
    assert_includes response.body, "Confirm your email address to subscribe."
    assert_not_includes response.body, "New Subscription Plan"
  end

  test "a trialing subscription shows when the trial ends" do
    pay_subscriptions(:one).update_columns(status: "trialing", trial_ends_at: 5.days.from_now)
    sign_in users(:subscribed)

    get_index

    assert_response :success
    assert_includes response.body, "Your free trial ends on"
    assert_includes response.body, "Free trial ends:"
    assert_includes response.body, "your card will be charged then unless you cancel"
    assert_not_includes response.body, "Next scheduled payment"
  end

  test "an active subscription still shows its next payment" do
    pay_subscriptions(:one).update_columns(current_period_end: 20.days.from_now)
    sign_in users(:subscribed)

    get_index

    assert_response :success
    assert_includes response.body, "Next scheduled payment"
    assert_not_includes response.body, "Free trial ends:"
  end

  test "the reminders banner shows off by default on the index page" do
    pay_subscriptions(:one).update_columns(current_period_end: 20.days.from_now)
    sign_in users(:subscribed)

    get_index

    assert_response :success
    assert_includes response.body, "Subscription reminders are off"
    assert_includes response.body, "Turn on"
  end

  test "the reminders banner shows on once the user opts in, on the index page" do
    pay_subscriptions(:one).update_columns(current_period_end: 20.days.from_now)
    users(:subscribed).update!(subscription_reminders: true)
    sign_in users(:subscribed)

    get_index

    assert_response :success
    assert_includes response.body, "Subscription reminders are on"
    assert_includes response.body, "Turn off"
  end

  test "the reminders banner is absent for a user with no subscription" do
    sign_in users(:one)

    get_index

    assert_response :success
    assert_not_includes response.body, "Subscription reminders are"
  end

  test "the reminders banner shows off by default on the plan page" do
    pay_subscriptions(:one).update_columns(current_period_end: 20.days.from_now)
    sign_in users(:subscribed)
    portal = Struct.new(:url).new("https://billing.stripe.test/portal")

    Stripe::BillingPortal::Session.stub(:create, portal) do
      get subscription_path(pay_subscriptions(:one))
    end

    assert_response :success
    assert_includes response.body, "Subscription reminders are off for this plan"
  end

  private
    # The index re-syncs from Stripe and links to the billing portal for subscribers;
    # stub both rather than hitting the API.
    def get_index
      portal = Struct.new(:url).new("https://billing.stripe.test/portal")
      Stripe::Subscription.stub(:list, []) do
        Stripe::BillingPortal::Session.stub(:create, portal) do
          get subscriptions_path
        end
      end
    end
end
