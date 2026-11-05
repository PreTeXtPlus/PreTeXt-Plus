require "test_helper"

class AccountDeletionsControllerTest < ActionDispatch::IntegrationTest
  include ActionMailer::TestHelper

  setup do
    @user = users(:one)
  end

  def delete_account(password: "password123", acknowledge: "1")
    post account_deletion_path, params: { password: password, acknowledge: acknowledge }
  end

  test "the account page links to deletion" do
    sign_in @user
    get edit_user_path(@user)
    assert_select "a[href=?]", new_account_deletion_path
  end

  test "new spells out what will be deleted" do
    sign_in @user
    get new_account_deletion_path
    assert_response :success
    assert_match "#{@user.projects.count} projects", response.body
    assert_select "form[action=?]", account_deletion_path
  end

  test "new requires sign-in" do
    get new_account_deletion_path
    assert_redirected_to new_user_session_path
  end

  test "deleting schedules the account for deletion, emails the user, and signs them out" do
    sign_in @user

    assert_enqueued_emails 1 do
      delete_account
    end

    assert @user.reload.pending_deletion?
    assert_redirected_to new_user_session_path
    assert_match "reactivate", flash[:notice]

    get projects_path
    assert_redirected_to new_user_session_path
  end

  test "the account and its projects survive the request itself" do
    sign_in @user
    assert_no_difference [ "User.count", "Project.count" ] do
      delete_account
    end
  end

  test "a wrong password deletes nothing" do
    sign_in @user
    assert_no_enqueued_emails do
      delete_account(password: "wrong")
    end
    assert_response :unprocessable_entity
    assert_not @user.reload.pending_deletion?
  end

  test "deleting requires acknowledging the warning" do
    sign_in @user
    delete_account(acknowledge: "0")
    assert_response :unprocessable_entity
    assert_not @user.reload.pending_deletion?
  end

  test "a renewing subscription has to be cancelled first" do
    user = users(:subscribed)
    sign_in user

    get new_account_deletion_path
    assert_select "form[action=?]", account_deletion_path, count: 0
    assert_match "Cancel your subscription first", response.body

    delete_account
    assert_redirected_to new_account_deletion_path
    assert_not user.reload.pending_deletion?
  end

  test "a cancelled subscription does not block deletion" do
    user = users(:subscribed)
    pay_subscriptions(:one).update!(ends_at: 1.month.from_now)
    sign_in user

    delete_account
    assert user.reload.pending_deletion?
  end

  test "a pending account can only reach the reactivation page" do
    @user.request_deletion!
    sign_in @user

    get projects_path
    assert_redirected_to account_deletion_path

    get project_path(projects(:one), format: :json)
    assert_response :forbidden

    get new_account_deletion_path
    assert_redirected_to account_deletion_path

    get account_deletion_path
    assert_response :success
    assert_select "form[action=?]", account_deletion_path
  end

  test "a pending account can still sign out" do
    @user.request_deletion!
    sign_in @user

    delete destroy_user_session_path
    assert_redirected_to new_user_session_path
  end

  test "reactivating restores the account" do
    @user.request_deletion!
    sign_in @user

    delete account_deletion_path
    assert_redirected_to projects_path
    assert_not @user.reload.pending_deletion?

    get projects_path
    assert_response :success
  end

  test "the reactivation page is only for pending accounts" do
    sign_in @user
    get account_deletion_path
    assert_redirected_to edit_user_path(@user)
  end

  test "a pending account's public profile is hidden" do
    @user.request_deletion!
    get user_profile_path(@user.username)
    assert_response :not_found
  end
end
