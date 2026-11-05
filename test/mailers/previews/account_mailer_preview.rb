# Preview all emails at /rails/mailers/account_mailer
class AccountMailerPreview < ActionMailer::Preview
  # Preview this email at /rails/mailers/account_mailer/deletion_requested
  def deletion_requested
    user = User.take
    user.deletion_requested_at ||= Time.current
    AccountMailer.deletion_requested(user)
  end
end
