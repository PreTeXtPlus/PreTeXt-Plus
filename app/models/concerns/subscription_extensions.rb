module SubscriptionExtensions
  extend ActiveSupport::Concern

  def type
    SubscriptionType.find_by stripe_price_id: processor_plan
  end

  def user
    customer.owner
  end

  def subscription_seats
    SubscriptionSeat.where(pay_subscription_id: id)
  end

  def seated_users
    User.joins(:subscription_seats).where(subscription_seats: { pay_subscription_id: id })
  end
end
