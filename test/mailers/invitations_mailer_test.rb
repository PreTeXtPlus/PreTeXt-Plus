require "test_helper"

class InvitationsMailerTest < ActionMailer::TestCase
  test "invite email is addressed to the given email" do
    inviter = users(:one)
    mail = InvitationsMailer.invite("invited@example.com", inviter)
    assert_equal [ "invited@example.com" ], mail.to
  end

  test "invite email has the correct subject" do
    inviter = users(:one)
    mail = InvitationsMailer.invite("invited@example.com", inviter)
    assert_equal "You've been invited to PreTeXt.Plus!", mail.subject
  end

  test "invite email addressed to existing user includes their email" do
    inviter = users(:one)
    invitee = users(:two)
    mail = InvitationsMailer.invite(invitee.email, inviter, invitee)
    assert_equal [ invitee.email ], mail.to
    assert_equal "You've been invited to PreTeXt.Plus!", mail.subject
  end
end
