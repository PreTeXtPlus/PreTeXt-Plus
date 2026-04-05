require "test_helper"

class FeedbackMailerTest < ActionMailer::TestCase
  test "submit_feedback is addressed to feedback@pretext.plus" do
    mail = FeedbackMailer.submit_feedback(message: "Great app!")
    assert_equal [ "feedback@pretext.plus" ], mail.to
  end

  test "submit_feedback has the correct subject without user email" do
    mail = FeedbackMailer.submit_feedback(message: "Test message")
    assert_equal "PreTeXt.Plus Feedback", mail.subject
  end

  test "submit_feedback includes sender email in subject when provided" do
    mail = FeedbackMailer.submit_feedback(message: "Test", user_email: "alice@example.com")
    assert_equal "PreTeXt.Plus Feedback from alice@example.com", mail.subject
  end

  test "submit_feedback sets reply_to when valid email provided" do
    mail = FeedbackMailer.submit_feedback(message: "Test", user_email: "alice@example.com")
    assert_equal [ "alice@example.com" ], mail.reply_to
  end

  test "submit_feedback does not set reply_to for invalid email" do
    mail = FeedbackMailer.submit_feedback(message: "Test", user_email: "not-an-email")
    assert_nil mail.reply_to
  end

  test "submit_feedback includes message in body" do
    mail = FeedbackMailer.submit_feedback(message: "This is my feedback")
    assert_includes mail.body.encoded, "This is my feedback"
  end

  test "submit_feedback includes project link when project_id provided" do
    mail = FeedbackMailer.submit_feedback(message: "Test", project_id: "abc-123")
    assert_includes mail.body.encoded, "abc-123"
  end

  test "submit_feedback includes source content when provided" do
    mail = FeedbackMailer.submit_feedback(message: "Test", source_content: "<pretext>hello</pretext>")
    assert_includes mail.body.encoded, "<pretext>hello</pretext>"
  end
end
