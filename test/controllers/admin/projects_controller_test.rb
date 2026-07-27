require "test_helper"

class Admin::ProjectsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
    @project = projects(:two)
  end

  test "redirects non-admin users" do
    sign_in @non_admin

    get admin_project_path(@project)

    assert_redirected_to projects_path
  end

  test "shows read-only project view for admins" do
    sign_in @admin

    get admin_project_path(@project)

    assert_response :success
    assert_includes response.body, @project.title
    assert_includes response.body, "Rendered share view"
    assert_includes response.body, "Read-only support view"
  end

  test "admin can flag a project as a template with a description" do
    sign_in @admin

    patch admin_project_path(@project), params: {
      project: { is_template: "1", template_description: "A great starter" }
    }

    assert_redirected_to admin_project_path(@project)
    @project.reload
    assert @project.is_template?
    assert_equal "A great starter", @project.template_description
  end

  test "non-admin cannot update template settings" do
    sign_in @non_admin

    patch admin_project_path(@project), params: { project: { is_template: "1" } }

    assert_redirected_to projects_path
    assert_not @project.reload.is_template?
  end
end
