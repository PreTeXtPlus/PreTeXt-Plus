require "test_helper"

class SubscriptionTypesControllerTest < ActionDispatch::IntegrationTest
  test "redirects unauthenticated requests to sign in" do
    post invoice_subscription_type_path(subscription_types(:three)), params: { quantity: 1 }

    assert_redirected_to new_user_session_path
  end

  test "renders the pay-by-invoice form for an invoiceable plan" do
    sign_in users(:subscribed)
    subscription_type = subscription_types(:three)

    get new_invoice_subscription_type_path(subscription_type)

    assert_response :success
    assert_includes response.body, subscription_type.name
  end

  test "redirects away from the pay-by-invoice form for a non-invoiceable plan" do
    sign_in users(:subscribed)
    subscription_type = subscription_types(:two)

    get new_invoice_subscription_type_path(subscription_type)

    assert_redirected_to subscriptions_path
    assert_match(/not payable by invoice/, flash[:alert])
  end

  test "creates an invoiced subscription for the current user" do
    sign_in users(:subscribed)
    subscription_type = subscription_types(:three)
    fake_subscription = build_stripe_subscription(
      id: "sub_self_serve_test",
      customer: pay_customers(:one).processor_id,
      price_id: subscription_type.stripe_price_id,
      quantity: 2
    )

    assert_difference -> { Pay::Stripe::Subscription.count }, 1 do
      Stripe::Subscription.stub(:create, fake_subscription) do
        post invoice_subscription_type_path(subscription_type), params: { quantity: 2 }
      end
    end

    assert_redirected_to subscriptions_path
    assert_match(/An invoice for 2 seat\(s\) has been sent/, flash[:notice])
    created = Pay::Stripe::Subscription.find_by(processor_id: "sub_self_serve_test")
    assert_equal subscription_type.stripe_price_id, created.processor_plan
    assert_equal 2, created.quantity
  end

  test "rejects a plan that is not invoiceable" do
    sign_in users(:subscribed)
    subscription_type = subscription_types(:two)
    assert_not subscription_type.invoiceable?

    assert_no_difference -> { Pay::Stripe::Subscription.count } do
      post invoice_subscription_type_path(subscription_type), params: { quantity: 1 }
    end

    assert_redirected_to subscriptions_path
    assert_match(/not payable by invoice/, flash[:alert])
  end

  test "rejects an invoiceable plan with no stripe price configured" do
    sign_in users(:subscribed)
    subscription_type = SubscriptionType.create!(name: "No Price", invoiceable: true)

    assert_no_difference -> { Pay::Stripe::Subscription.count } do
      post invoice_subscription_type_path(subscription_type), params: { quantity: 1 }
    end

    assert_redirected_to subscriptions_path
    assert_match(/not payable by invoice/, flash[:alert])
  end

  private
    def build_stripe_subscription(id:, customer:, price_id:, quantity: 1, status: "active")
      now = Time.current.to_i
      Stripe::Subscription.construct_from(
        id: id,
        object: "subscription",
        customer: customer,
        status: status,
        application_fee_percent: nil,
        created: now,
        metadata: {},
        pause_collection: nil,
        trial_end: nil,
        ended_at: nil,
        cancel_at: nil,
        cancel_at_period_end: false,
        default_payment_method: nil,
        items: {
          object: "list",
          has_more: false,
          data: [
            {
              id: "si_test",
              object: "subscription_item",
              price: { id: price_id, object: "price" },
              quantity: quantity,
              current_period_start: now,
              current_period_end: now + 30 * 24 * 60 * 60
            }
          ]
        }
      )
    end
end
