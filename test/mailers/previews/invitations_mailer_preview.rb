# Preview all emails at /rails/mailers/invitations_mailer
class InvitationsMailerPreview < ActionMailer::Preview
  # Preview this email at /rails/mailers/invitations_mailer/invoice_request
  def invoice_request_with_user
    inviter = User.take
    invitee = User.take
    InvitationsMailer.invite(invitee.email, inviter, invitee)
  end
  def invoice_request_without_user
    inviter = User.take
    email = "nonuser@example.com"
    InvitationsMailer.invite(email, inviter)
  end
end
