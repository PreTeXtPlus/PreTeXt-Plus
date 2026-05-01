# Preview all emails at /rails/mailers/subscriptions_mailer
class SubscriptionsMailerPreview < ActionMailer::Preview
  # Preview this email at /rails/mailers/subscriptions_mailer/invoice_request
  def invoice_request
    SubscriptionsMailer.invoice_request(User.take, "This is a sample invoice request for preview purposes.", 42)
  end
end
