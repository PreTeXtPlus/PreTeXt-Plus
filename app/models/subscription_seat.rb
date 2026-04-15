class SubscriptionSeat < ApplicationRecord
  belongs_to :subscription, class_name: "Pay::Stripe::Subscription", foreign_key: "pay_subscription_id"
  belongs_to :user, class_name: "User", foreign_key: "user_id"

  def active?
    self.subscription.active?
  end
end
