require "test_helper"

class Admin::SubscriptionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  test "redirects non-admin users from create" do
    sign_in @non_admin

    post admin_user_subscriptions_path(users(:subscribed)),
      params: { subscription_type_id: subscription_types(:three).id, quantity: 1 }

    assert_redirected_to projects_path
  end

  test "redirects non-admin users from update_seats" do
    sign_in @non_admin

    patch update_seats_admin_user_subscription_path(users(:subscribed), pay_subscriptions(:one)),
      params: { emails: "someone@example.com" }

    assert_redirected_to projects_path
  end

  test "redirects non-admin users from mark_invoice_paid" do
    sign_in @non_admin

    post mark_invoice_paid_admin_user_subscription_path(users(:subscribed), pay_subscriptions(:one))

    assert_redirected_to projects_path
  end

  test "creates an invoiced subscription for a user" do
    sign_in @admin
    target = users(:subscribed)
    subscription_type = subscription_types(:three)
    fake_subscription = build_stripe_subscription(
      id: "sub_new_test",
      customer: pay_customers(:one).processor_id,
      price_id: subscription_type.stripe_price_id,
      quantity: 3
    )

    assert_difference -> { Pay::Stripe::Subscription.count }, 1 do
      Stripe::Subscription.stub(:create, fake_subscription) do
        post admin_user_subscriptions_path(target),
          params: { subscription_type_id: subscription_type.id, quantity: 3, days_until_due: 45 }
      end
    end

    assert_redirected_to admin_user_path(target)
    assert_match(/Created #{subscription_type.name} subscription/, flash[:notice])
    created = Pay::Stripe::Subscription.find_by(processor_id: "sub_new_test")
    assert_equal subscription_type.stripe_price_id, created.processor_plan
    assert_equal 3, created.quantity
  end

  test "rejects creating a subscription for a plan with no stripe price" do
    sign_in @admin
    target = users(:subscribed)
    subscription_type = subscription_types(:one)

    assert_no_difference -> { Pay::Stripe::Subscription.count } do
      post admin_user_subscriptions_path(target),
        params: { subscription_type_id: subscription_type.id, quantity: 1 }
    end

    assert_redirected_to admin_user_path(target)
    assert_match(/no Stripe price configured/, flash[:alert])
  end

  test "rejects a seat update that exceeds the subscription's quantity" do
    sign_in @admin
    subscription = pay_subscriptions(:one)

    patch update_seats_admin_user_subscription_path(users(:subscribed), subscription),
      params: { emails: "a@example.com, b@example.com" }

    assert_redirected_to admin_user_path(users(:subscribed))
    assert_match(/this plan has 1 seat/, flash[:alert])
  end

  test "updates seats, replacing prior assignments" do
    sign_in @admin
    subscription = pay_subscriptions(:one)
    subscription.update!(quantity: 2)

    patch update_seats_admin_user_subscription_path(users(:subscribed), subscription),
      params: { emails: "new-seat@example.com" }

    assert_redirected_to admin_user_path(users(:subscribed))
    assert_equal [ "new-seat@example.com" ], subscription.reload.seated_users.map(&:email)
  end

  test "404s when the subscription does not belong to the given user" do
    sign_in @admin
    other_user = users(:two)
    Pay::Customer.create!(owner: other_user, processor: :stripe, processor_id: "cus_other", default: true)

    patch update_seats_admin_user_subscription_path(other_user, pay_subscriptions(:one)),
      params: { emails: "" }

    assert_response :not_found
  end

  test "marks an open invoice as paid outside stripe" do
    sign_in @admin
    subscription = pay_subscriptions(:one)
    subscription.update!(object: { "latest_invoice" => { "id" => "in_test123", "object" => "invoice" } })

    fake_invoice = Stripe::Invoice.construct_from(id: "in_test123", object: "invoice", status: "open", number: "TEST-0001")
    fake_resynced_subscription = build_stripe_subscription(
      id: subscription.processor_id,
      customer: pay_customers(:one).processor_id,
      price_id: subscription.processor_plan,
      quantity: subscription.quantity
    )
    paid_called = false

    Stripe::Invoice.stub(:retrieve, fake_invoice) do
      Stripe::Invoice.stub(:pay, ->(id, **_opts) { paid_called = true; fake_invoice }) do
        Stripe::Subscription.stub(:retrieve, fake_resynced_subscription) do
          post mark_invoice_paid_admin_user_subscription_path(users(:subscribed), subscription)
        end
      end
    end

    assert paid_called
    assert_redirected_to admin_user_path(users(:subscribed))
    assert_match(/Marked invoice/, flash[:notice])
  end

  test "rejects marking a non-open invoice as paid" do
    sign_in @admin
    subscription = pay_subscriptions(:one)
    subscription.update!(object: { "latest_invoice" => { "id" => "in_test123", "object" => "invoice" } })
    fake_invoice = Stripe::Invoice.construct_from(id: "in_test123", object: "invoice", status: "paid", number: "TEST-0001")

    Stripe::Invoice.stub(:retrieve, fake_invoice) do
      post mark_invoice_paid_admin_user_subscription_path(users(:subscribed), subscription)
    end

    assert_redirected_to admin_user_path(users(:subscribed))
    assert_match(/not open/, flash[:alert])
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
