class SubscriptionDigestJob < ApplicationJob
  queue_as :default

  def perform
    since = 1.day.ago
    return if Pay::Subscription.where("created_at >= ?", since).none?

    User.where(admin: true).each do |admin|
      AdminDigestMailer.subscription_digest(admin.email, since).deliver_later
    end
  end
end
