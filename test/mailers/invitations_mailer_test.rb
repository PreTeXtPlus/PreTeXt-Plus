require "test_helper"

class InvitationsMailerTest < ActionMailer::TestCase
  test "invite email is addressed to the given email" do
    mail = InvitationsMailer.invite("invited@example.com")
    assert_equal [ "invited@example.com" ], mail.to
  end

  test "invite email has the correct subject" do
    mail = InvitationsMailer.invite("invited@example.com")
    assert_equal "You've been invited to PreTeXt.Plus!", mail.subject
  end

  test "invite email addressed to existing user includes their email" do
    user = users(:one)
    mail = InvitationsMailer.invite(user.email, user)
    assert_equal [ user.email ], mail.to
  end
end
