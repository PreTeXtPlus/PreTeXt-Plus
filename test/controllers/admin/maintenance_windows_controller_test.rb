require "test_helper"

class Admin::MaintenanceWindowsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  test "redirects unauthenticated users from index" do
    get admin_maintenance_windows_path
    assert_redirected_to new_user_session_path
  end

  test "redirects non-admin users from index" do
    sign_in @non_admin
    get admin_maintenance_windows_path
    assert_redirected_to projects_path
  end

  test "non-admin cannot create a maintenance window" do
    sign_in @non_admin
    assert_no_difference("MaintenanceWindow.count") do
      post admin_maintenance_windows_path, params: { maintenance_window: { starts_at: 1.day.from_now } }
    end
  end

  test "index lists windows" do
    sign_in @admin
    get admin_maintenance_windows_path
    assert_response :success
    assert_includes response.body, maintenance_windows(:upcoming).note
  end

  test "new renders form" do
    sign_in @admin
    get new_admin_maintenance_window_path
    assert_response :success
  end

  test "create with valid params creates window and redirects" do
    sign_in @admin
    assert_difference("MaintenanceWindow.count") do
      post admin_maintenance_windows_path, params: { maintenance_window: { starts_at: 1.day.from_now, note: "Upgrade" } }
    end
    assert_redirected_to admin_maintenance_windows_path
  end

  test "create with invalid params re-renders new" do
    sign_in @admin
    assert_no_difference("MaintenanceWindow.count") do
      post admin_maintenance_windows_path, params: { maintenance_window: { starts_at: "" } }
    end
    assert_response :unprocessable_entity
  end

  test "edit renders form" do
    sign_in @admin
    get edit_admin_maintenance_window_path(maintenance_windows(:upcoming))
    assert_response :success
  end

  test "update with valid params updates window and redirects" do
    sign_in @admin
    patch admin_maintenance_window_path(maintenance_windows(:upcoming)), params: { maintenance_window: { note: "Updated" } }
    assert_redirected_to admin_maintenance_windows_path
    assert_equal "Updated", maintenance_windows(:upcoming).reload.note
  end

  test "update with invalid params re-renders edit" do
    sign_in @admin
    patch admin_maintenance_window_path(maintenance_windows(:upcoming)), params: { maintenance_window: { starts_at: "" } }
    assert_response :unprocessable_entity
  end

  test "destroy deletes window and redirects to index" do
    sign_in @admin
    assert_difference("MaintenanceWindow.count", -1) do
      delete admin_maintenance_window_path(maintenance_windows(:upcoming))
    end
    assert_redirected_to admin_maintenance_windows_path
  end

  test "banner shows on pages when a window is within the warning period" do
    MaintenanceWindow.create!(starts_at: 2.hours.from_now, note: "Back by noon")
    sign_in @non_admin
    get projects_path
    assert_select "[data-controller='maintenance-banner']", text: /Back by noon/

    get root_path
    assert_select "[data-controller='maintenance-banner']"
  end

  test "banner is absent when the next window is beyond the warning period" do
    sign_in @non_admin
    get projects_path
    assert_select "[data-controller='maintenance-banner']", count: 0
  end
end
