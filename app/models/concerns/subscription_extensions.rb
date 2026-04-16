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
    active? or on_trial?
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
