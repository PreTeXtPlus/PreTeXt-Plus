class InvitationsMailer < ApplicationMailer
  def invite(email, inviter, invitee_user = nil)
    @invitee_user = invitee_user
    @email = email
    @inviter = inviter
    mail subject: "You've been invited to PreTeXt.Plus!", to: email
  end
end
