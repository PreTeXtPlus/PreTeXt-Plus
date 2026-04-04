require "test_helper"

class PasswordsMailerTest < ActionMailer::TestCase
  include Rails.application.routes.url_helpers

  setup do
    @default_url_options = Rails.application.config.action_mailer.default_url_options || {}
  end

  test "reset email is addressed to the user" do
    user = users(:one)
    mail = PasswordsMailer.reset(user)
    assert_equal [ user.email ], mail.to
  end

  test "reset email has the correct subject" do
    user = users(:one)
    mail = PasswordsMailer.reset(user)
    assert_equal "Reset your password", mail.subject
  end

  test "reset email body contains a password reset link" do
    user = users(:one)
    mail = PasswordsMailer.reset(user)
    assert_match %r{/passwords/.+/edit}, mail.body.encoded
  end
end
