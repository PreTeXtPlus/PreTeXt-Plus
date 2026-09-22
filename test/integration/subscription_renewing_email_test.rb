require "test_helper"

# Exercises Pay's real invoice.upcoming webhook handler against our
# Pay.emails.subscription_renewing policy (config/initializers/pay.rb), including the
# subscription_reminders user setting (SubscriptionExtensions#reminders_enabled?).
class SubscriptionRenewingEmailTest < ActiveSupport::TestCase
  include ActionMailer::TestHelper

  FakeType = Struct.new(:recurrence)

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

  # type_recurrence stubs SubscriptionType#recurrence, which drives the interval-based
  # default in reminders_enabled? -- SubscriptionType#stripe_price (and so #recurrence)
  # is nil in the test environment otherwise.
  def handle(event, price:, type_recurrence: nil)
    Stripe::Price.stub(:retrieve, price) do
      if type_recurrence
        SubscriptionType.stub(:find_by, FakeType.new(type_recurrence)) do
          Pay::Stripe::Webhooks::SubscriptionRenewing.new.call(event)
        end
      else
        Pay::Stripe::Webhooks::SubscriptionRenewing.new.call(event)
      end
    end
  end

  test "emails a monthly subscriber who opted in" do
    pay_subscriptions(:one).user.update!(subscription_reminders: true)

    assert_emails 1 do
      perform_enqueued_jobs { handle(upcoming_invoice_event, price: price(interval: "month")) }
    end

    mail = ActionMailer::Base.deliveries.last
    assert_equal "Thank you for your support of PreTeXt.Plus!", mail.subject
    assert_equal [ "subbed@example.com" ], mail.to
  end

  test "does not email a monthly subscriber by default (off unless opted in)" do
    assert_no_enqueued_emails do
      handle(upcoming_invoice_event, price: price(interval: "month"))
    end
  end

  test "emails an annual subscriber by default (on unless opted out)" do
    assert_enqueued_emails 1 do
      handle(upcoming_invoice_event, price: price(interval: "year"), type_recurrence: "year")
    end
  end

  test "does not email an annual subscriber who opted out" do
    pay_subscriptions(:one).user.update!(subscription_reminders: false)

    assert_no_enqueued_emails do
      handle(upcoming_invoice_event, price: price(interval: "year"), type_recurrence: "year")
    end
  end

  test "does not email a subscription that is still on its trial" do
    pay_subscriptions(:one).update_columns(status: "trialing", trial_ends_at: 3.days.from_now)
    pay_subscriptions(:one).user.update!(subscription_reminders: true)

    assert_no_enqueued_emails do
      handle(upcoming_invoice_event, price: price)
    end
  end

  test "does not email a subscription set to cancel" do
    pay_subscriptions(:one).update_columns(ends_at: 2.days.from_now)
    pay_subscriptions(:one).user.update!(subscription_reminders: true)

    assert_no_enqueued_emails do
      handle(upcoming_invoice_event, price: price)
    end
  end

  test "does not email when Stripe will not auto-charge (no next payment attempt)" do
    pay_subscriptions(:one).user.update!(subscription_reminders: true)

    assert_no_enqueued_emails do
      handle(upcoming_invoice_event(next_payment_attempt: nil), price: price)
    end
  end

  test "does not email for a one-time price" do
    pay_subscriptions(:one).user.update!(subscription_reminders: true)

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
