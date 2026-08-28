class SubscriptionPaymentMailer < ApplicationMailer
  def payment_received(admin_email, subscription, amount_cents, currency, kind, manual)
    @subscription = subscription
    @user = subscription.user
    @plan_name = subscription.type&.name
    @interval = subscription.type&.recurrence
    @amount = Pay::Currency.format(amount_cents, currency: currency)
    @kind = kind
    @manual = manual

    label = (kind == :new) ? "New subscription" : "Renewal"
    mail(subject: "PreTeXt.Plus #{label} payment — #{@amount}", to: admin_email)
  end
end
