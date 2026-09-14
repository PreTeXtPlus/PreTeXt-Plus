require "test_helper"

class SubscriptionDigestJobTest < ActiveJob::TestCase
  include ActionMailer::TestHelper

  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
  end

  test "sends nothing when there is no new or canceled activity" do
    assert_no_emails do
      SubscriptionDigestJob.perform_now
    end
  end

  test "sends to every admin when there is a new subscription" do
    Pay::Stripe::Charge.create!(
      customer: pay_customers(:one),
      subscription: pay_subscriptions(:one),
      processor_id: "ch_#{SecureRandom.hex(6)}",
      amount: 999,
      currency: "usd",
      created_at: 1.hour.ago,
      data: { "stripe_invoice" => { "billing_reason" => "subscription_create" } }
    )

    assert_emails User.where(admin: true).count do
      SubscriptionDigestJob.perform_now
    end

    mail = ActionMailer::Base.deliveries.last
    assert_equal [ @admin.email ], mail.to
  end
end
