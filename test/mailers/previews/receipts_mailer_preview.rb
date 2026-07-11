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
end
