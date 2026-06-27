require "test_helper"

class Admin::AnnouncementsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  # authorization

  test "redirects unauthenticated users from index" do
    get admin_announcements_path
    assert_redirected_to new_user_session_path
  end

  test "redirects non-admin users from index" do
    sign_in @non_admin
    get admin_announcements_path
    assert_redirected_to projects_path
  end

  # index

  test "index lists all announcements including drafts" do
    sign_in @admin
    get admin_announcements_path
    assert_response :success
    assert_includes response.body, announcements(:published).title
    assert_includes response.body, announcements(:draft).title
  end

  # show

  test "show renders announcement" do
    sign_in @admin
    get admin_announcement_path(announcements(:published))
    assert_response :success
    assert_includes response.body, announcements(:published).title
  end

  # new / create

  test "new renders form" do
    sign_in @admin
    get new_admin_announcement_path
    assert_response :success
  end

  test "create with valid params creates announcement and redirects" do
    sign_in @admin
    assert_difference("Announcement.count") do
      post admin_announcements_path, params: { announcement: { title: "New Title", body: "New body." } }
    end
    assert_response :redirect
    assert_match %r{/admin/announcements/}, response.location
  end

  test "create with invalid params re-renders new" do
    sign_in @admin
    assert_no_difference("Announcement.count") do
      post admin_announcements_path, params: { announcement: { title: "", body: "" } }
    end
    assert_response :unprocessable_entity
  end

  # edit / update

  test "edit renders form" do
    sign_in @admin
    get edit_admin_announcement_path(announcements(:draft))
    assert_response :success
  end

  test "update with valid params updates announcement and redirects" do
    sign_in @admin
    patch admin_announcement_path(announcements(:draft)),
      params: { announcement: { title: "Updated", body: "Updated body." } }
    assert_redirected_to admin_announcement_path(announcements(:draft))
    assert_equal "Updated", announcements(:draft).reload.title
  end

  test "update with invalid params re-renders edit" do
    sign_in @admin
    patch admin_announcement_path(announcements(:draft)),
      params: { announcement: { title: "", body: "" } }
    assert_response :unprocessable_entity
  end

  # destroy

  test "destroy deletes announcement and redirects to index" do
    sign_in @admin
    assert_difference("Announcement.count", -1) do
      delete admin_announcement_path(announcements(:draft))
    end
    assert_redirected_to admin_announcements_path
  end

  # publish

  test "publish sets published_at and enqueues broadcast job" do
    sign_in @admin
    assert_enqueued_with(job: BroadcastAnnouncementJob) do
      post publish_admin_announcement_path(announcements(:draft))
    end
    assert announcements(:draft).reload.published?
    assert_redirected_to admin_announcement_path(announcements(:draft))
  end

  test "publish on already-published announcement redirects with alert" do
    sign_in @admin
    post publish_admin_announcement_path(announcements(:published))
    assert_redirected_to admin_announcement_path(announcements(:published))
    assert_equal "This announcement has already been published.", flash[:alert]
  end
end
