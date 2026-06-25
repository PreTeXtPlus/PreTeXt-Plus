require "test_helper"

class Admin::UsersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  test "redirects non-admin users from index" do
    sign_in @non_admin

    get admin_users_path

    assert_redirected_to projects_path
  end

  test "renders filtered users index for admins" do
    sign_in @admin

    get admin_users_path, params: { q: "subbed", subscribed: "1" }

    assert_response :success
    assert_includes response.body, "subbed@example.com"
    assert_not_includes response.body, "two@example.com"
    assert_includes response.body, "Subscribed"
  end

  test "filters admins without using the admin attribute name in params" do
    sign_in @admin

    get admin_users_path, params: { admins_only: "1" }

    assert_response :success
    assert_includes response.body, @admin.email
    assert_not_includes response.body, users(:subscribed).email
  end

  test "shows user detail with projects and subscription data" do
    project = Project.create!(user: users(:subscribed), title: "Support Project")
    sign_in @admin

    get admin_user_path(users(:subscribed))

    assert_response :success
    assert_includes response.body, "subbed@example.com"
    assert_includes response.body, "Support Project"
    assert_includes response.body, project.title
    assert_includes response.body, "Subscription access"
  end

  test "shows confirmation status and filters unconfirmed users" do
    sign_in @admin

    get admin_users_path, params: { unconfirmed: "1" }

    assert_response :success
    assert_includes response.body, users(:unconfirmed).email
    assert_not_includes response.body, users(:subscribed).email
    assert_includes response.body, "Unconfirmed"
  end

  test "shows a confirm button for unconfirmed users" do
    sign_in @admin

    get admin_user_path(users(:unconfirmed))

    assert_response :success
    assert_includes response.body, "Confirm email"
  end

  test "does not show a confirm button for confirmed users" do
    sign_in @admin

    get admin_user_path(users(:subscribed))

    assert_response :success
    assert_not_includes response.body, "Confirm email"
  end

  test "confirms an unconfirmed user" do
    sign_in @admin

    post confirm_admin_user_path(users(:unconfirmed))

    assert_redirected_to admin_user_path(users(:unconfirmed))
    assert users(:unconfirmed).reload.confirmed?
  end

  test "redirects non-admin users from confirm" do
    sign_in @non_admin

    post confirm_admin_user_path(users(:unconfirmed))

    assert_redirected_to projects_path
    assert_not users(:unconfirmed).reload.confirmed?
  end

  test "search escapes sql like wildcards" do
    User.create!(email: "test_user@example.com", name: "Exact User", password: "password123", confirmed_at: Time.current)
    User.create!(email: "testxuser@example.com", name: "Wildcard User", password: "password123", confirmed_at: Time.current)
    sign_in @admin

    get admin_users_path, params: { q: "test_user" }

    assert_response :success
    assert_includes response.body, "test_user@example.com"
    assert_not_includes response.body, "testxuser@example.com"
  end
end
