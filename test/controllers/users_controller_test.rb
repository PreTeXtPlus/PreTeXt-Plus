require "test_helper"

class UsersControllerTest < ActionDispatch::IntegrationTest
  test "new renders sign-up form" do
    get new_user_path
    assert_response :success
  end

  test "new redirects authenticated users away" do
    sign_in_as(users(:one))
    get new_user_path
    assert_redirected_to projects_path
  end

  test "create with valid params signs in and redirects" do
    assert_difference("User.count") do
      post users_path, params: { user: { email: "new@example.com", password: "secret123", name: "New User" } }
    end
    assert_redirected_to projects_path
    assert cookies[:session_id]
  end

  test "create with invalid params re-renders form" do
    assert_no_difference("User.count") do
      post users_path, params: { user: { email: "valid@example.com", password: "" } }
    end
    assert_response :unprocessable_entity
  end

  test "create with duplicate email re-renders form" do
    assert_no_difference("User.count") do
      post users_path, params: { user: { email: users(:one).email, password: "password" } }
    end
    assert_response :unprocessable_entity
  end

  test "update changes user name" do
    sign_in_as(users(:one))
    patch user_path(users(:one)), params: { user: { name: "Updated Name" } }
    assert_redirected_to projects_path
    assert_equal "Updated Name", users(:one).reload.name
  end
end
