require "test_helper"

class Admin::ProjectsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
    @project = projects(:two)
  end

  test "redirects non-admin users" do
    sign_in_as(@non_admin)

    get admin_project_path(@project)

    assert_redirected_to projects_path
  end

  test "shows read-only project view for admins" do
    sign_in_as(@admin)

    get admin_project_path(@project)

    assert_response :success
    assert_includes response.body, @project.title
    assert_includes response.body, "Rendered share view"
    assert_includes response.body, "Read-only support view"
  end
end
