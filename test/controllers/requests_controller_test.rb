require "test_helper"

class RequestsControllerTest < ActionDispatch::IntegrationTest
  test "create submits an invitation request and redirects" do
    user = users(:two)
    Request.where(user: user).destroy_all
    sign_in_as(user)

    assert_difference("Request.count") do
      post requests_path
    end
    assert_redirected_to projects_path
  end

  test "create redirects to login when unauthenticated" do
    post requests_path
    assert_redirected_to new_session_path
  end
end
