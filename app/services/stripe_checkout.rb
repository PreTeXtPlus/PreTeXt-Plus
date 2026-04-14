class StripeCheckout
  # h/t https://github.com/shey/rails-pay-checkout-demo

  attr_reader :user, :subscription_type

  def initialize(user, subscription_type)
    @user = user
    @subscription_type = subscription_type
  end

  def url
    checkout.url
  end

  private

  def checkout
    user.payment_processor.checkout(
      mode: "subscription",
      line_items: subscription_type.stripe_price_id,
      success_url: "https://#{request.host}/session",
      billing_address_collection: "auto",
      allow_promotion_codes: false
    )
  end
end
