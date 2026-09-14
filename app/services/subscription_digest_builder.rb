class SubscriptionDigestBuilder
  NewSubscription = Struct.new(:subscription, :charge, keyword_init: true)
  CanceledSubscription = Struct.new(:subscription, keyword_init: true)
  Result = Struct.new(:new_subscriptions, :canceled_subscriptions) do
    def empty?
      new_subscriptions.empty? && canceled_subscriptions.empty?
    end
  end

  def initialize(since:)
    @since = since
  end

  def build
    Result.new(new_subscriptions, canceled_subscriptions)
  end

  private

  attr_reader :since

  # Only a charge's own billing_reason distinguishes a brand-new subscription from a
  # renewal -- that lives in a jsonb blob (Pay::Stripe::Charge#stripe_invoice), so it
  # can't be filtered in SQL and is checked in Ruby instead.
  def new_subscriptions
    Pay::Stripe::Charge.where(created_at: since..).where.not(subscription_id: nil).filter_map do |charge|
      next unless charge.stripe_invoice&.billing_reason == "subscription_create"
      NewSubscription.new(subscription: charge.subscription, charge: charge)
    end
  end

  # "Previously-paying" excludes a canceled subscription that never had a successful
  # charge (e.g. an abandoned trial) -- pay_subscriptions has no canceled_at column, so
  # updated_at is the best available proxy for when the cancellation actually landed.
  def canceled_subscriptions
    Pay::Stripe::Subscription.where(status: "canceled", updated_at: since..)
      .select { |subscription| Pay::Stripe::Charge.exists?(subscription_id: subscription.id) }
      .map { |subscription| CanceledSubscription.new(subscription: subscription) }
  end
end
