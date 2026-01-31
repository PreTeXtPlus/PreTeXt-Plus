class InvitationsMailer < ApplicationMailer
  def invite(email, user = nil)
    @user = user
    @email = email
    mail subject: "You've been invited to PreTeXt.Plus!", to: email
  end
end
