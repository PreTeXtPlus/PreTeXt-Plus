require "test_helper"

class UsersControllerTest < ActionDispatch::IntegrationTest
  test "new renders sign-up form" do
    get new_user_path
    assert_response :success
  end

  test "new redirects authenticated users away" do
    sign_in users(:one)
    get new_user_path
    assert_redirected_to projects_path
  end

  test "create with valid params creates user and redirects to projects path" do
    assert_difference("User.count") do
      post users_path, params: { user: { email: "new@example.com", password: "secret123", name: "New User" } }
    end
    assert_redirected_to projects_path
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
    sign_in users(:one)
    patch user_path(users(:one)), params: { user: { name: "Updated Name" } }
    assert_redirected_to edit_user_path(users(:one))
    assert_equal "Updated Name", users(:one).reload.name
  end

  test "update changes user common_docinfo" do
    sign_in users(:one)
    docinfo = "<docinfo><macros>\\newcommand{\\Q}{\\mathbb{Q}}</macros></docinfo>"

    patch user_path(users(:one)), params: { user: { common_docinfo: docinfo } }

    assert_redirected_to edit_user_path(users(:one))
    assert_equal docinfo, users(:one).reload.common_docinfo
  end

  test "update changes username" do
    sign_in users(:one)
    patch user_path(users(:one)), params: { user: { username: "brand-new-name" } }
    assert_redirected_to edit_user_path(users(:one))
    assert_equal "brand-new-name", users(:one).reload.username
  end

  test "update rejects a username already taken by another user" do
    sign_in users(:one)
    patch user_path(users(:one)), params: { user: { username: users(:two).username } }
    assert_response :unprocessable_entity
    assert_not_equal users(:two).username, users(:one).reload.username
  end

  test "profile is visible to its own owner even when not a subscriber" do
    sign_in users(:one)
    get user_profile_path(users(:one).username)
    assert_response :success
  end

  test "profile 404s for a stranger when the owner is not a subscriber" do
    sign_in users(:two)
    get user_profile_path(users(:one).username)
    assert_response :not_found
  end

  test "profile 404s for an unauthenticated visitor when the owner is not a subscriber" do
    get user_profile_path(users(:one).username)
    assert_response :not_found
  end

  test "profile 404s for an unknown username" do
    get user_profile_path("no-such-user")
    assert_response :not_found
  end

  test "profile is visible to anyone when the owner is a subscriber" do
    get user_profile_path(users(:subscribed).username)
    assert_response :success
    assert_select "h3", text: projects(:public_project).title
  end

  test "profile lists only the owner's public-visibility projects" do
    sign_in users(:subscribed)
    get user_profile_path(users(:subscribed).username)
    assert_response :success
    assert_select "h3", text: projects(:public_project).title
  end
end
