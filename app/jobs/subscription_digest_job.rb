class SubscriptionDigestJob < ApplicationJob
  queue_as :default

  def perform
    since = 1.day.ago
    User.where(admin: true).each do |admin|
      AdminDigestMailer.subscription_digest(admin.email, since).deliver_later
    end
  end
end
