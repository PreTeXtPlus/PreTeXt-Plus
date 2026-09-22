module SubscriptionExtensions
  extend ActiveSupport::Concern

  included do
    after_create_commit do
      unless self.user.subscribed?
        SubscriptionSeat.create!(subscription: self, user: self.user)
      end
    end
  end

  def type
    SubscriptionType.find_by stripe_price_id: processor_plan
  end

  def user
    customer.owner
  end

  def grants_privileges?
    return false if invoiced? && !invoice_paid? && !user.honor_invoices?
    active? or on_trial?
  end

  def invoiced?
    object&.dig("collection_method") == "send_invoice"
  end

  def invoice_paid?
    object&.dig("latest_invoice", "status") == "paid"
  end

  # Whether the renewal-reminder email (see config/initializers/pay.rb) should go out
  # for this subscription: an explicit per-user choice, if the user has made one,
  # otherwise the plan's interval-based default (annual on, monthly off). This is the
  # one place that decision is made, so the email gate and the account UI can't disagree.
  def reminders_enabled?
    explicit = user&.subscription_reminders
    return explicit unless explicit.nil?
    type&.recurrence == "year"
  end

  def price
    type.stripe_price.unit_amount / 100.0 * quantity
  end

  def subscription_seats
    SubscriptionSeat.where(pay_subscription_id: id)
  end

  def seated_users
    User.joins(:subscription_seats).where(subscription_seats: { pay_subscription_id: id })
  end
end
