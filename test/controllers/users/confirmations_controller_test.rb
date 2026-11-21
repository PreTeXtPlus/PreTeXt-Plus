require "test_helper"

class Users::ConfirmationsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:unconfirmed)
    @user.update_columns(confirmation_token: "tok123", confirmation_sent_at: 1.month.ago)
  end

  test "opening the emailed link shows a button and does not confirm" do
    get user_confirmation_path(confirmation_token: "tok123")

    assert_response :success
    assert_select "form[action=?]", confirm_user_confirmation_path do
      assert_select "input[name=confirmation_token][value=tok123]"
    end
    assert_not @user.reload.confirmed?
  end

  test "pressing the button confirms, even long after the email was sent" do
    post confirm_user_confirmation_path, params: { confirmation_token: "tok123" }

    assert_redirected_to new_user_session_path
    assert @user.reload.confirmed?
  end

  test "the link keeps working after a scanner opens it" do
    2.times { get user_confirmation_path(confirmation_token: "tok123") }
    post confirm_user_confirmation_path, params: { confirmation_token: "tok123" }

    assert @user.reload.confirmed?
  end

  test "opening the link again after confirming says so instead of showing the resend form" do
    post confirm_user_confirmation_path, params: { confirmation_token: "tok123" }
    get user_confirmation_path(confirmation_token: "tok123")

    assert_redirected_to new_user_session_path
    assert_match(/already confirmed/, flash[:notice])
  end

  test "pressing the button twice says already confirmed" do
    2.times { post confirm_user_confirmation_path, params: { confirmation_token: "tok123" } }

    assert_redirected_to new_user_session_path
    assert_match(/already confirmed/, flash[:notice])
  end

  test "already confirmed sends a signed-in user to their projects" do
    @user.confirm
    sign_in @user
    get user_confirmation_path(confirmation_token: "tok123")

    assert_redirected_to projects_path
  end

  test "a pending email change still shows the button for the new address" do
    @user.confirm
    @user.update_columns(unconfirmed_email: "new@example.com")
    get user_confirmation_path(confirmation_token: "tok123")

    assert_response :success
    assert_match "new@example.com", response.body
  end

  test "an unknown token explains itself" do
    get user_confirmation_path(confirmation_token: "nope")

    assert_response :unprocessable_entity
    assert_match(/confirmation link isn.t valid/, response.body)
  end

  test "a missing token explains itself" do
    get user_confirmation_path

    assert_response :unprocessable_entity
    assert_match(/confirmation link isn.t valid/, response.body)
  end

  test "resending reuses the original token, so earlier emails still work" do
    assert_emails 1 do
      post user_confirmation_path, params: { user: { email: @user.email } }
    end
    assert_equal "tok123", @user.reload.confirmation_token
  end

  test "resending to a confirmed address says so and sends nothing" do
    assert_no_emails do
      post user_confirmation_path, params: { user: { email: users(:one).email } }
    end
    assert_redirected_to new_user_session_path
    assert_match(/already confirmed/, flash[:notice])
  end

  test "resending to an unknown address shows the error" do
    post user_confirmation_path, params: { user: { email: "nobody@example.com" } }

    assert_response :unprocessable_entity
    assert_match(/not found/, response.body)
  end
end
