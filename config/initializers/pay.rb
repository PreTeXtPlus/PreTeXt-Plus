Pay.setup do |config|
  config.support_email = "support@pretext.plus"
  config.application_name = "PreTeXt.Plus"
  config.business_name = "PreTeXt Plus, LLC"
  config.parent_mailer = "ApplicationMailer"
  config.mailer = "ReceiptsMailer"

  # Upcoming-renewal notice (Stripe's invoice.upcoming webhook) for every recurring plan,
  # not just annual as Pay defaults to. Skipped for trials, which are covered by
  # subscription_trial_will_end (and "thank you for your support" doesn't fit someone who
  # hasn't paid yet), and for subscriptions set to cancel, which won't be charged.
  config.emails.subscription_renewing = lambda { |pay_subscription, price|
    price&.type == "recurring" && !pay_subscription.on_trial? && !pay_subscription.canceled?
  }
end

Rails.application.config.to_prepare do
  Pay::Stripe::Subscription.include SubscriptionExtensions
end
