require "test_helper"

# Exercises Pay's real invoice.upcoming webhook handler against our
# Pay.emails.subscription_renewing policy (config/initializers/pay.rb).
class SubscriptionRenewingEmailTest < ActiveSupport::TestCase
  include ActionMailer::TestHelper

  def upcoming_invoice_event(subscription_id: pay_subscriptions(:one).processor_id, next_payment_attempt: 2.days.from_now.to_i)
    Stripe::Event.construct_from(
      id: "evt_upcoming",
      object: "event",
      type: "invoice.upcoming",
      data: {
        object: {
          object: "invoice",
          parent: { subscription_details: { subscription: subscription_id } },
          lines: { object: "list", data: [ { pricing: { price_details: { price: "price_test" } } } ] },
          next_payment_attempt: next_payment_attempt
        }
      }
    )
  end

  def price(type: "recurring", interval: "month")
    Stripe::Price.construct_from(id: "price_test", object: "price", type: type, recurring: type == "recurring" ? { interval: interval } : nil)
  end

  def handle(event, price:)
    Stripe::Price.stub(:retrieve, price) do
      Pay::Stripe::Webhooks::SubscriptionRenewing.new.call(event)
    end
  end

  test "emails the owner of a monthly subscription" do
    assert_emails 1 do
      perform_enqueued_jobs { handle(upcoming_invoice_event, price: price(interval: "month")) }
    end

    mail = ActionMailer::Base.deliveries.last
    assert_equal "Thank you for your support of PreTeXt.Plus!", mail.subject
    assert_equal [ "subbed@example.com" ], mail.to
  end

  test "emails the owner of an annual subscription" do
    assert_enqueued_emails 1 do
      handle(upcoming_invoice_event, price: price(interval: "year"))
    end
  end

  test "does not email a subscription that is still on its trial" do
    pay_subscriptions(:one).update_columns(status: "trialing", trial_ends_at: 3.days.from_now)

    assert_no_enqueued_emails do
      handle(upcoming_invoice_event, price: price)
    end
  end

  test "does not email a subscription set to cancel" do
    pay_subscriptions(:one).update_columns(ends_at: 2.days.from_now)

    assert_no_enqueued_emails do
      handle(upcoming_invoice_event, price: price)
    end
  end

  test "does not email when Stripe will not auto-charge (no next payment attempt)" do
    assert_no_enqueued_emails do
      handle(upcoming_invoice_event(next_payment_attempt: nil), price: price)
    end
  end

  test "does not email for a one-time price" do
    assert_no_enqueued_emails do
      handle(upcoming_invoice_event, price: price(type: "one_time"))
    end
  end

  test "does not email for a subscription we do not know about" do
    assert_no_enqueued_emails do
      handle(upcoming_invoice_event(subscription_id: "sub_unknown"), price: price)
    end
  end
end
