require "test_helper"

class ReceiptsMailerTest < ActionMailer::TestCase
  FakePrice = Struct.new(:unit_amount)
  FakeType = Struct.new(:name, :stripe_price, :recurrence)

  def renewing_mail(date: Time.zone.local(2026, 10, 3, 12))
    ReceiptsMailer.with(
      pay_customer: pay_customers(:one),
      pay_subscription: pay_subscriptions(:one),
      date: date
    ).subscription_renewing
  end

  test "subscription_renewing thanks the subscriber and is addressed to the customer" do
    mail = renewing_mail

    assert_equal "Thank you for your support of PreTeXt.Plus!", mail.subject
    assert_equal [ "subbed@example.com" ], mail.to
  end

  test "subscription_renewing states the renewal date and how to manage the subscription" do
    mail = renewing_mail

    [ mail.html_part, mail.text_part ].each do |part|
      body = part.body.to_s
      assert_includes body, "October 3, 2026"
      assert_includes body, "will renew automatically"
      assert_includes body, "http://example.com/subscriptions"
      assert_includes body, "Manage payment info"
    end
  end

  test "subscription_renewing links to account settings to change reminders" do
    mail = renewing_mail

    [ mail.html_part, mail.text_part ].each do |part|
      body = part.body.to_s
      assert_includes body, "turn subscription reminders on or off"
      assert_includes body, Rails.application.routes.url_helpers.edit_user_url(pay_subscriptions(:one).user, host: "example.com")
    end
  end

  test "subscription_renewing omits the amount when the price is unavailable" do
    mail = renewing_mail

    assert_not_includes mail.text_part.body.to_s, "$"
  end

  test "subscription_renewing shows the plan, seats and amount when the price is known" do
    subscription = pay_subscriptions(:one)
    subscription.update_columns(quantity: 2)
    fake_type = FakeType.new("Sustaining", FakePrice.new(999), "month")

    SubscriptionType.stub(:find_by, fake_type) do
      mail = renewing_mail

      [ mail.html_part, mail.text_part ].each do |part|
        body = part.body.to_s.squish
        assert_includes body, "Your Sustaining subscription"
        assert_includes body, "(2 seats)"
        assert_includes body, "at $19.98/month"
      end
    end
  end
end
