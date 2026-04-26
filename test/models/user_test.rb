require "test_helper"

class UserTest < ActiveSupport::TestCase
  test "downcases and strips email" do
    user = User.new(email: " DOWNCASED@EXAMPLE.COM ")
    assert_equal("downcased@example.com", user.email)
  end

  test "project_quota is 10_000 for admin" do
    user = users(:one)
    user.admin = true
    assert_equal 10_000, user.project_quota
  end

  test "project_quota is 0 for uninvited user" do
    user = users(:one)
    user.admin = false
    Invitation.where(recipient_user: user).destroy_all
    assert_equal 0, user.project_quota
  end

  test "project_quota is 10 for invited unsubscribed user" do
    user = users(:one)
    user.admin = false
    assert user.invited?
    assert_not user.subscribed?
    assert_equal 10, user.project_quota
  end

  test "project_quota is 100 for subscribed user" do
    user = users(:subscribed)
    assert_equal 100, user.project_quota
  end

  test "has_copiable_projects? is true for admin" do
    user = users(:one)
    user.admin = true
    assert user.has_copiable_projects?
  end

  test "has_copiable_projects? is true for subscriber" do
    user = users(:subscribed)
    user.admin = false
    assert user.has_copiable_projects?
  end

  test "has_copiable_projects? is false for unsubscribed user" do
    user = users(:one)
    user.admin = false
    assert_not user.has_copiable_projects?
  end

  test "invited? returns true when an invitation exists for the user" do
    user = users(:one)
    assert user.invited?
  end

  test "invited? returns false when no invitation exists" do
    user = users(:one)
    Invitation.where(recipient_user: user).destroy_all
    assert_not user.invited?
  end

  test "name_with_email returns formatted string when name present" do
    user = users(:one)
    user.name = "Alice"
    user.email = "alice@example.com"
    assert_equal "Alice <alice@example.com>", user.name_with_email
  end

  test "name_with_email returns just email when name blank" do
    user = users(:one)
    user.name = nil
    assert_equal user.email, user.name_with_email
  end

  test "claim_intended_invitations links open invitations on create" do
    invitation = Invitation.create!(
      owner_user: users(:two),
      intended_email: "newuser@example.com"
    )
    assert_nil invitation.recipient_user

    new_user = User.create!(
      email: "newuser@example.com",
      password: "secret123"
    )
    new_user.send(:claim_intended_invitations)

    assert_equal new_user, invitation.reload.recipient_user
  end

  test "new users get default common_docinfo" do
    user = User.create!(
      email: "defaults@example.com",
      password: "secret123"
    )

    assert_equal Project.default_docinfo, user.reload.common_docinfo
  end
end
