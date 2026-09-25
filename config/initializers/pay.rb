Pay.setup do |config|
  config.support_email = "support@pretext.plus"
  config.application_name = "PreTeXt.Plus"
  config.business_name = "PreTeXt Plus, LLC"
  config.parent_mailer = "ApplicationMailer"
  config.mailer = "ReceiptsMailer"

  # Upcoming-renewal notice (Stripe's invoice.upcoming webhook). Skipped for trials,
  # which are covered by subscription_trial_will_end (and "thank you for your support"
  # doesn't fit someone who hasn't paid yet), and for subscriptions set to cancel, which
  # won't be charged. Whether it's sent otherwise is decided by
  # SubscriptionExtensions#reminders_enabled? -- on by default for annual plans, off for
  # monthly, and overridable per user from account settings or the subscriptions page.
  config.emails.subscription_renewing = lambda { |pay_subscription, price|
    price&.type == "recurring" && !pay_subscription.on_trial? && !pay_subscription.canceled? &&
      pay_subscription.reminders_enabled?
  }
end

Rails.application.config.to_prepare do
  Pay::Stripe::Subscription.include SubscriptionExtensions
end
