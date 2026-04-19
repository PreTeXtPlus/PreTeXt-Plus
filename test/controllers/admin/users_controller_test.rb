require "test_helper"

class Admin::UsersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  test "redirects non-admin users from index" do
    sign_in_as(@non_admin)

    get admin_users_path

    assert_redirected_to projects_path
  end

  test "renders filtered users index for admins" do
    sign_in_as(@admin)
    users(:subscribed).sessions.create!(ip_address: "127.0.0.1", user_agent: "Support Browser")

    get admin_users_path, params: { q: "subbed", subscribed: "1" }

    assert_response :success
    assert_includes response.body, "subbed@example.com"
    assert_not_includes response.body, "two@example.com"
    assert_includes response.body, "Subscribed"
  end

  test "shows user detail with projects and subscription data" do
    project = Project.create!(user: users(:subscribed), title: "Support Project", source: "<section><title>Help</title></section>")
    sign_in_as(@admin)
    users(:subscribed).sessions.create!(ip_address: "127.0.0.1", user_agent: "Support Browser")

    get admin_user_path(users(:subscribed))

    assert_response :success
    assert_includes response.body, "subbed@example.com"
    assert_includes response.body, "Support Project"
    assert_includes response.body, project.title
    assert_includes response.body, "Subscription access"
  end

  test "search escapes sql like wildcards" do
    User.create!(email: "test_user@example.com", name: "Exact User", password: "password123")
    User.create!(email: "testxuser@example.com", name: "Wildcard User", password: "password123")
    sign_in_as(@admin)

    get admin_users_path, params: { q: "test_user" }

    assert_response :success
    assert_includes response.body, "test_user@example.com"
    assert_not_includes response.body, "testxuser@example.com"
  end
end
