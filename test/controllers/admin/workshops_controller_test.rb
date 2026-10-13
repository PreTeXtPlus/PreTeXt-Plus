require "test_helper"

class Admin::WorkshopsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  test "redirects unauthenticated users from index" do
    get admin_workshops_path
    assert_redirected_to new_user_session_path
  end

  test "redirects non-admin users from index" do
    sign_in @non_admin
    get admin_workshops_path
    assert_redirected_to projects_path
  end

  test "non-admin cannot create a workshop" do
    sign_in @non_admin
    assert_no_difference("Workshop.count") do
      post admin_workshops_path, params: { workshop: { title: "X", start_time: 1.day.from_now, link: "https://example.com" } }
    end
  end

  test "index lists past and upcoming workshops" do
    sign_in @admin
    get admin_workshops_path
    assert_response :success
    assert_includes response.body, workshops(:upcoming).title
    assert_includes response.body, workshops(:past).title
  end

  test "new renders form" do
    sign_in @admin
    get new_admin_workshop_path
    assert_response :success
  end

  test "create with valid params creates workshop and redirects" do
    sign_in @admin
    assert_difference("Workshop.count") do
      post admin_workshops_path, params: { workshop: { title: "New Workshop", start_time: 5.days.from_now, link: "https://example.com/new" } }
    end
    assert_redirected_to admin_workshops_path
  end

  test "create with invalid params re-renders new" do
    sign_in @admin
    assert_no_difference("Workshop.count") do
      post admin_workshops_path, params: { workshop: { title: "", start_time: "", link: "javascript:alert(1)" } }
    end
    assert_response :unprocessable_entity
  end

  test "edit renders form" do
    sign_in @admin
    get edit_admin_workshop_path(workshops(:upcoming))
    assert_response :success
  end

  test "update with valid params updates workshop and redirects" do
    sign_in @admin
    patch admin_workshop_path(workshops(:upcoming)), params: { workshop: { title: "Updated" } }
    assert_redirected_to admin_workshops_path
    assert_equal "Updated", workshops(:upcoming).reload.title
  end

  test "update can mark a workshop as free" do
    sign_in @admin
    patch admin_workshop_path(workshops(:later)), params: { workshop: { free: "1" } }
    assert_redirected_to admin_workshops_path
    assert workshops(:later).reload.free?
  end

  test "update with invalid params re-renders edit" do
    sign_in @admin
    patch admin_workshop_path(workshops(:upcoming)), params: { workshop: { link: "" } }
    assert_response :unprocessable_entity
  end

  test "destroy deletes workshop and redirects to index" do
    sign_in @admin
    assert_difference("Workshop.count", -1) do
      delete admin_workshop_path(workshops(:upcoming))
    end
    assert_redirected_to admin_workshops_path
  end
end
