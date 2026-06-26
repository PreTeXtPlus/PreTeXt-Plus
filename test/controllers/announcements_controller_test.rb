require "test_helper"

class AnnouncementsControllerTest < ActionDispatch::IntegrationTest
  # index

  test "index is publicly accessible" do
    get announcements_path
    assert_response :success
  end

  test "index lists published announcements" do
    get announcements_path
    assert_includes response.body, announcements(:published).title
    assert_includes response.body, announcements(:recent).title
  end

  test "index does not list draft announcements" do
    get announcements_path
    assert_not_includes response.body, announcements(:draft).title
  end

  # show

  test "show is publicly accessible for published announcements" do
    get announcement_path(announcements(:published))
    assert_response :success
    assert_includes response.body, announcements(:published).title
  end

  test "show is not accessible for draft announcements" do
    get announcement_path(announcements(:draft))
    assert_redirected_to projects_path
  end

  # unsubscribe

  test "unsubscribe with valid token unsubscribes user" do
    user = users(:one)
    token = user.announcement_unsubscribe_token
    user.update!(announcement_emails: true)

    get unsubscribe_announcements_path(token: token)

    assert_response :success
    assert_not user.reload.announcement_emails
  end

  test "unsubscribe with invalid token shows failure" do
    get unsubscribe_announcements_path(token: "invalid-token")
    assert_response :success
  end

  test "unsubscribe does not require authentication" do
    user = users(:two)
    get unsubscribe_announcements_path(token: user.announcement_unsubscribe_token)
    assert_response :success
  end

  # subscribe

  test "subscribe requires authentication" do
    post subscribe_announcements_path
    assert_redirected_to new_user_session_path
  end

  test "subscribe enables announcement emails for current user" do
    user = users(:one)
    user.update!(announcement_emails: false)
    sign_in user

    post subscribe_announcements_path

    assert_redirected_to edit_user_path(user)
    assert user.reload.announcement_emails
  end
end
