require "test_helper"

class AccountMailerTest < ActionMailer::TestCase
  test "deletion_requested says when the deletion becomes permanent and how to undo it" do
    user = users(:one)
    user.request_deletion!

    mail = AccountMailer.deletion_requested(user)

    assert_equal [ user.email ], mail.to
    assert_match "deleted", mail.subject
    date = user.purge_at.strftime("%B %-d, %Y")
    [ mail.html_part, mail.text_part ].each do |part|
      assert_match date, part.body.to_s
      assert_match "reactivate", part.body.to_s
    end
  end
end
