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

  test "checkout gives a first-time subscriber the plan's trial and requires a card" do
    user = users(:one)
    give_stripe_customer(user)
    sign_in user

    params = capture_checkout_params { get checkout_subscription_type_path(subscription_types(:two)) }

    assert_response :see_other
    assert_redirected_to "https://checkout.stripe.test/session"
    assert_equal "always", params[:payment_method_collection]
    assert_equal 7, params[:subscription_data][:trial_period_days]
    assert_equal "cancel", params[:subscription_data][:trial_settings][:end_behavior][:missing_payment_method]
    assert_match(/7-day free trial/, params[:custom_text][:submit][:message])
  end

  test "checkout gives no trial to a user who has already subscribed" do
    sign_in users(:subscribed)

    params = capture_checkout_params { get checkout_subscription_type_path(subscription_types(:two)) }

    assert_response :see_other
    assert_equal "always", params[:payment_method_collection]
    assert_nil params[:subscription_data]
    assert_nil params[:custom_text]
  end

  test "checkout gives no trial when the plan has none" do
    user = users(:one)
    give_stripe_customer(user)
    sign_in user
    subscription_type = subscription_types(:two)
    subscription_type.update!(trial_days: 0)

    params = capture_checkout_params { get checkout_subscription_type_path(subscription_type) }

    assert_response :see_other
    assert_equal "always", params[:payment_method_collection]
    assert_nil params[:subscription_data]
  end

  test "unconfirmed users cannot start a checkout" do
    sign_in_unconfirmed

    Stripe::Checkout::Session.stub(:create, ->(*) { flunk "should not reach Stripe" }) do
      get checkout_subscription_type_path(subscription_types(:two))
    end

    assert_redirected_to projects_path
    assert_match(/confirm your email/i, flash[:alert])
  end

  test "unconfirmed users cannot view the pay-by-invoice form" do
    sign_in_unconfirmed

    get new_invoice_subscription_type_path(subscription_types(:three))

    assert_redirected_to projects_path
    assert_match(/confirm your email/i, flash[:alert])
  end

  test "unconfirmed users cannot create an invoiced subscription" do
    sign_in_unconfirmed

    assert_no_difference -> { Pay::Stripe::Subscription.count } do
      Stripe::Subscription.stub(:create, ->(*) { flunk "should not reach Stripe" }) do
        post invoice_subscription_type_path(subscription_types(:three)), params: { quantity: 1 }
      end
    end

    assert_redirected_to projects_path
    assert_match(/confirm your email/i, flash[:alert])
  end

  private
    # Unconfirmed users may sign in for a grace period, counted from when the
    # confirmation email was sent.
    def sign_in_unconfirmed
      user = users(:unconfirmed)
      user.update_columns(confirmation_sent_at: Time.current)
      sign_in user
    end

    # Gives the user an existing Stripe customer so checkout doesn't try to create one.
    def give_stripe_customer(user)
      Pay::Stripe::Customer.create!(owner: user, processor: "stripe", processor_id: "cus_#{user.id}", default: true)
    end

    # Runs the block with Stripe::Checkout::Session.create stubbed, returning the
    # params the app sent to Stripe.
    def capture_checkout_params
      sent = nil
      session = Struct.new(:url).new("https://checkout.stripe.test/session")
      Stripe::Checkout::Session.stub(:create, ->(params, *) { sent = params; session }) do
        yield
      end
      sent
    end

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
