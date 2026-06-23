class AdminDigestMailer < ApplicationMailer
  def subscription_digest(admin_email, since)
    @subscriptions = Pay::Subscription.where("created_at >= ?", since).order(created_at: :desc)
    @since = since
    mail(
      subject: "PreTeXt.Plus Subscription Digest — #{since.to_date.strftime("%B %-d, %Y")}",
      to: admin_email
    )
  end
end
