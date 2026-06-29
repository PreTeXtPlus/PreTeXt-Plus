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

  test "index does not list paid-only announcements for guests" do
    get announcements_path
    assert_not_includes response.body, announcements(:paid_only).title
  end

  test "index does not list paid-only announcements for non-subscribers" do
    sign_in users(:one)
    get announcements_path
    assert_not_includes response.body, announcements(:paid_only).title
  end

  test "index lists paid-only announcements for paid subscribers" do
    sign_in users(:subscribed)
    get announcements_path
    assert_includes response.body, announcements(:paid_only).title
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

  test "show is not accessible for paid-only announcements for guests" do
    get announcement_path(announcements(:paid_only))
    assert_redirected_to projects_path
  end

  test "show is not accessible for paid-only announcements for non-subscribers" do
    sign_in users(:one)
    get announcement_path(announcements(:paid_only))
    assert_redirected_to projects_path
  end

  test "show is accessible for paid-only announcements for paid subscribers" do
    sign_in users(:subscribed)
    get announcement_path(announcements(:paid_only))
    assert_response :success
    assert_includes response.body, announcements(:paid_only).title
  end
end
