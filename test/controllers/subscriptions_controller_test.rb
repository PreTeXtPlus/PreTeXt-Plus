require "test_helper"

class SubscriptionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as(@user)
  end

  # Posts a fake Stripe webhook by stubbing Stripe::Webhook.construct_event to
  # return the given event hash, bypassing signature verification.
  def post_stripe_webhook(event_hash)
    require "stripe"
    fake_event = Stripe::Event.construct_from(event_hash.deep_stringify_keys)
    Stripe::Webhook.stub(:construct_event, fake_event) do
      post stripe_webhooks_path,
        params: event_hash.to_json,
        headers: {
          "Content-Type" => "application/json",
          "HTTP_STRIPE_SIGNATURE" => "t=1,v1=stub"
        },
        as: :json
    end
  end

  test "webhooks returns 400 for invalid signature" do
    ENV["STRIPE_WEBHOOK_SECRET"] = "whsec_test"
    post stripe_webhooks_path,
      params: '{"type":"customer.created"}',
      headers: {
        "Content-Type" => "application/json",
        "HTTP_STRIPE_SIGNATURE" => "t=1,v1=badsig"
      },
      as: :json
    assert_response 400
  ensure
    ENV.delete("STRIPE_WEBHOOK_SECRET")
  end

  test "subscribe creates checkout session for first-time subscriber" do
    require "stripe"
    checkout_session = Struct.new(:id, :url).new("cs_test_new", "https://checkout.example.test")

    Stripe::Checkout::Session.stub(:create, checkout_session) do
      post subscribe_path
    end

    assert_redirected_to "https://checkout.example.test"
    assert_equal "cs_test_new", @user.reload.stripe_checkout_session_id
  end

  test "subscribe uses billing portal for existing checkout session" do
    require "stripe"
    @user.update!(stripe_checkout_session_id: "cs_existing")
    checkout_session = Struct.new(:customer).new("cus_existing")
    portal_session = Struct.new(:url).new("https://portal.example.test")

    Stripe::Checkout::Session.stub(:retrieve, checkout_session) do
      Stripe::BillingPortal::Session.stub(:create, portal_session) do
        post subscribe_path
      end
    end

    assert_redirected_to "https://portal.example.test"
    assert_equal "cs_existing", @user.reload.stripe_checkout_session_id
  end

  test "webhooks customer.created sets stripe_customer_id" do
    customer_id = "cus_test_#{SecureRandom.hex(4)}"
    post_stripe_webhook({
      type: "customer.created",
      data: { object: { email: @user.email, id: customer_id } }
    })
    assert_response :success
    assert_equal customer_id, @user.reload.stripe_customer_id
  end

  test "webhooks customer.subscription.created upgrades user to sustaining" do
    customer_id = "cus_sub_#{SecureRandom.hex(4)}"
    @user.update!(stripe_customer_id: customer_id)

    assert_difference("Invitation.count", 10) do
      post_stripe_webhook({
        type: "customer.subscription.created",
        data: { object: { customer: customer_id } }
      })
    end
    assert_response :success
    assert @user.reload.sustaining_subscription?
  end

  test "webhooks customer.subscription.deleted downgrades user to beta" do
    customer_id = "cus_del_#{SecureRandom.hex(4)}"
    @user.update!(stripe_customer_id: customer_id, subscription: :sustaining)

    post_stripe_webhook({
      type: "customer.subscription.deleted",
      data: { object: { customer: customer_id } }
    })
    assert_response :success
    assert @user.reload.beta_subscription?
  end

  test "webhooks returns success for unhandled event types" do
    post_stripe_webhook({ type: "checkout.session.completed", data: { object: {} } })
    assert_response :success
  end

  test "webhooks customer.created returns 400 when email has no matching user" do
    post_stripe_webhook({
      type: "customer.created",
      data: { object: { email: "nobody@example.com", id: "cus_missing" } }
    })
    assert_response 400
  end

  test "webhooks customer.subscription.created returns 400 for unknown customer id" do
    assert_no_difference("Invitation.count") do
      post_stripe_webhook({
        type: "customer.subscription.created",
        data: { object: { customer: "cus_missing" } }
      })
    end
    assert_response 400
  end

  test "webhooks customer.subscription.deleted returns 400 for unknown customer id" do
    post_stripe_webhook({
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_missing" } }
    })
    assert_response 400
  end
end
