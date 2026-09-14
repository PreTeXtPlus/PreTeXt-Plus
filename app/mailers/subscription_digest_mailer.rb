class SubscriptionDigestMailer < ApplicationMailer
  def admin_digest(admin_email, new_charges, canceled_subscriptions)
    @new_charges = new_charges
    @canceled_subscriptions = canceled_subscriptions

    mail(
      subject: "PreTeXt.Plus subscription digest — #{@new_charges.size} new, #{@canceled_subscriptions.size} canceled",
      to: admin_email
    )
  end
end
