class PaymentSucceededHandler
  # h/t https://github.com/shey/rails-pay-checkout-demo
  def call(event)
    pay_charge = Pay::Stripe::Charge.sync(
      event.data.object.charge,
      stripe_account: event.try(:account)
    )
    return if pay_charge.nil?

    adjust_user(pay_charge)
  end

  def adjust_user(pay_charge)
    user = pay_charge.customer.owner
    user.update!(updated_at: Time.zone.now)
  end
end
