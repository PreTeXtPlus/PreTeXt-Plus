module ChargeExtensions
  extend ActiveSupport::Concern

  included do
    after_create_commit :notify_admins_of_payment
  end

  private

  def notify_admins_of_payment
    return if subscription.blank? # skip non-subscription (one-time) charges

    AdminSubscriptionNotifier.new(
      subscription: subscription,
      amount_cents: amount,
      currency: currency,
      billing_reason: stripe_invoice&.billing_reason
    ).notify!
  end
end
