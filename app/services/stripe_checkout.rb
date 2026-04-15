class StripeCheckout
  # h/t https://github.com/shey/rails-pay-checkout-demo

  attr_reader :user, :subscription_type, :return_url

  def initialize(user, subscription_type, return_url)
    @user = user
    @subscription_type = subscription_type
    @return_url = return_url
  end

  def url
    checkout.url
  end

  private

  def checkout
    user.payment_processor.checkout(
      mode: "subscription",
      line_items: [ {
        price: subscription_type.stripe_price_id,
        quantity: 1,
        adjustable_quantity: { enabled: true }
      } ],
      success_url: @return_url,
      cancel_url: @return_url,
      billing_address_collection: "auto",
      allow_promotion_codes: false
    )
  end
end
