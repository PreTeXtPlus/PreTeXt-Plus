class SubscriptionsMailer < ApplicationMailer
  def invoice_request(user, details)
    @user = user
    @details = details
    mail subject: "Invoice Request for PreTeXt.Plus", to: [ user.email, "support@pretext.plus" ]
  end
end
