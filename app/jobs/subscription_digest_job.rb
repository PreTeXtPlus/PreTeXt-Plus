# Nightly rollup replacing the old instant per-charge admin email: reports new paying
# subscriptions and cancellations of previously-paying subscriptions from the last day.
# Renewals are never reported, instant or digest.
class SubscriptionDigestJob < ApplicationJob
  queue_as :default

  WINDOW = 24.hours

  def perform
    result = SubscriptionDigestBuilder.new(since: WINDOW.ago).build
    return if result.empty?

    # deliver_later serializes job arguments via GlobalID, so the mailer takes plain
    # arrays of AR records rather than the builder's Result (a Struct isn't serializable).
    new_charges = result.new_subscriptions.map(&:charge)
    canceled_subscriptions = result.canceled_subscriptions.map(&:subscription)

    User.where(admin: true).find_each do |admin|
      SubscriptionDigestMailer.admin_digest(admin.email, new_charges, canceled_subscriptions).deliver_later
    end
  end
end
