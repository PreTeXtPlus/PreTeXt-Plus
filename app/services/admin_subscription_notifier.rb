class AdminSubscriptionNotifier
  def initialize(subscription:, amount_cents:, currency:, billing_reason: nil, manual: false)
    @subscription = subscription
    @amount_cents = amount_cents
    @currency = currency
    @billing_reason = billing_reason
    @manual = manual
  end

  def notify!
    return if @subscription.blank?

    User.where(admin: true).each do |admin|
      SubscriptionPaymentMailer.payment_received(
        admin.email, @subscription, @amount_cents, @currency, kind, @manual
      ).deliver_later
    end
  end

  private

  def kind
    (@billing_reason == "subscription_create") ? :new : :renewal
  end
end
