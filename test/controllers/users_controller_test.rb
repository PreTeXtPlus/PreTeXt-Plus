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

  test "create defaults to subscribed for announcements" do
    post users_path, params: { user: { email: "subbed@test.com", password: "secret123", name: "New User" } }
    assert User.find_by(email: "subbed@test.com").announcement_emails
  end

  test "create with announcement_emails unchecked opts user out" do
    post users_path, params: { user: { email: "unsubbed@test.com", password: "secret123", name: "New User", announcement_emails: "0" } }
    assert_not User.find_by(email: "unsubbed@test.com").announcement_emails
  end

  test "new renders announcement subscription checkbox" do
    get new_user_path
    assert_includes response.body, "announcement_emails"
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
end
