Pay.setup do |config|
  config.support_email = "support@pretext.plus"
  config.application_name = "PreTeXt.Plus"
  config.business_name = "PreTeXt Plus, LLC"
end

Rails.application.config.to_prepare do
  Pay::Stripe::Subscription.include SubscriptionExtensions
end
