require "test_helper"

class InvitationsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  test "new redirects non-admin users" do
    sign_in_as(@non_admin)
    get new_invitation_path
    assert_redirected_to projects_path
  end

  test "new renders for admin" do
    sign_in_as(@admin)
    get new_invitation_path
    assert_response :success
  end

  test "create for_user creates invitations for the specified user" do
    sign_in_as(@admin)
    assert_difference("Invitation.count", 2) do
      post invitations_path, params: { mode: "for_user", email: @non_admin.email, amount: "2" }
    end
    assert_redirected_to projects_path
  end

  test "create for_user with unknown email re-renders with notice" do
    sign_in_as(@admin)
    post invitations_path, params: { mode: "for_user", email: "nobody@example.com", amount: "1" }
    assert_response :unprocessable_entity
  end

  test "create for_user with invalid amount re-renders with notice" do
    sign_in_as(@admin)
    post invitations_path, params: { mode: "for_user", email: @non_admin.email, amount: "0" }
    assert_response :unprocessable_entity
  end

  test "create for_user caps invitation amount at 100" do
    sign_in_as(@admin)
    assert_difference("Invitation.count", 100) do
      post invitations_path, params: { mode: "for_user", email: @non_admin.email, amount: "200" }
    end
    assert_redirected_to projects_path
  end

  test "create for_all creates invitations for all invited users" do
    sign_in_as(@admin)
    invited_users_count = User.joins("INNER JOIN invitations ON users.id = invitations.recipient_user_id").distinct.count
    assert_difference("Invitation.count", invited_users_count * 2) do
      post invitations_path, params: { mode: "for_all", amount: "2" }
    end
    assert_redirected_to projects_path
  end

  test "create for_all caps invitation amount at 5 per user" do
    sign_in_as(@admin)
    invited_users_count = User.joins("INNER JOIN invitations ON users.id = invitations.recipient_user_id").distinct.count
    assert_difference("Invitation.count", invited_users_count * 5) do
      post invitations_path, params: { mode: "for_all", amount: "99" }
    end
    assert_redirected_to projects_path
  end

  test "create direct_email sends invitation email" do
    sign_in_as(@admin)
    assert_difference("Invitation.count") do
      assert_enqueued_emails 1 do
        post invitations_path, params: { mode: "direct_email", emails: "invited@example.com" }
      end
    end
    assert_redirected_to projects_path
  end

  test "create direct_email with blank emails re-renders with notice" do
    sign_in_as(@admin)
    post invitations_path, params: { mode: "direct_email", emails: "" }
    assert_response :unprocessable_entity
  end

  test "create accept_request invites selected users" do
    sign_in_as(@admin)
    request_user = users(:two)
    assert_difference("Invitation.count") do
      assert_enqueued_emails 1 do
        post invitations_path, params: { mode: "accept_request", user_ids: [ request_user.id ] }
      end
    end
    assert_redirected_to projects_path
  end

  test "create accept_request with no users re-renders with notice" do
    sign_in_as(@admin)
    post invitations_path, params: { mode: "accept_request", user_ids: [] }
    assert_response :unprocessable_entity
  end

  test "create with invalid mode re-renders with notice" do
    sign_in_as(@admin)
    post invitations_path, params: { mode: "bogus" }
    assert_response :unprocessable_entity
  end

  test "redeem with valid unused code claims the invitation" do
    invitation = invitations(:one)
    invitation.update!(recipient_user: nil, intended_email: nil)
    sign_in_as(@non_admin)

    post redeem_invitation_path, params: { code: invitation.code }

    assert_redirected_to projects_path
    assert_equal @non_admin, invitation.reload.recipient_user
  end

  test "redeem with invalid code redirects with alert" do
    sign_in_as(@non_admin)
    post redeem_invitation_path, params: { code: "00000000-0000-0000-0000-000000000000" }
    assert_redirected_to projects_path
  end

  test "redeem already-used code redirects with alert" do
    invitation = invitations(:one)
    sign_in_as(@non_admin)
    post redeem_invitation_path, params: { code: invitation.code }
    assert_redirected_to projects_path
  end
end
