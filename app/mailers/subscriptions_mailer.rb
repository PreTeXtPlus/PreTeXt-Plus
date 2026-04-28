class SubscriptionsMailer < ApplicationMailer
  def invoice_request(user, details, seats)
    @user = user
    @details = details
    @seats = seats
    mail subject: "Invoice Request for PreTeXt.Plus", to: [ user.email, "support@pretext.plus" ]
  end
end
