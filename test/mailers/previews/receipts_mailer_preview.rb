# Preview all emails at /rails/mailers/receipts_mailer
class ReceiptsMailerPreview < ActionMailer::Preview
  # Preview this email at /rails/mailers/receipts_mailer/receipt
  def receipt
    user = User.take
    pay_customer = user.payment_processor || user.set_payment_processor(:stripe)
    pay_charge = Pay::Charge.new(
      customer: pay_customer,
      amount: 900,
      currency: "usd",
      created_at: Time.current,
      data: { payment_method_type: "card", brand: "visa", last4: "4242" }
    )

    ReceiptsMailer.with(pay_customer: pay_customer, pay_charge: pay_charge).receipt
  end

  # Preview this email at /rails/mailers/receipts_mailer/subscription_renewing
  def subscription_renewing
    user = User.take
    pay_customer = user.payment_processor || user.set_payment_processor(:stripe)
    pay_subscription = pay_customer.subscriptions.first || Pay::Stripe::Subscription.new(
      customer: pay_customer,
      processor_plan: SubscriptionType.where.not(stripe_price_id: [ nil, "" ]).pick(:stripe_price_id),
      quantity: 2
    )

    ReceiptsMailer.with(
      pay_customer: pay_customer,
      pay_subscription: pay_subscription,
      date: 2.days.from_now
    ).subscription_renewing
  end
end
