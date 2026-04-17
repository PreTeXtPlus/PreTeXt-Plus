# Preview all emails at /rails/mailers/passwords_mailer
class PasswordsMailerPreview < ActionMailer::Preview
  # Preview this email at /rails/mailers/passwords_mailer/reset
  def reset
    PasswordsMailer.reset(User.take)
  end
end
