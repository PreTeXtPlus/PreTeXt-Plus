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

  test "project_quota is 10 for unsubscribed user" do
    user = users(:one)
    user.admin = false
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

  test "username is optional" do
    user = User.new(email: "nousername@example.com", password: "secret123")
    assert user.valid?
  end

  test "username is stripped but keeps its casing" do
    user = users(:one)
    user.username = "  MixedCase  "
    assert_equal "MixedCase", user.username
  end

  test "blank username normalizes to nil" do
    user = users(:one)
    user.username = "   "
    assert_nil user.username
  end

  test "username must be unique case-insensitively" do
    user = User.new(email: "dupe@example.com", password: "secret123", username: users(:one).username.upcase)
    assert_not user.valid?
    assert_includes user.errors[:username], "has already been taken"
  end

  test "username rejects invalid characters" do
    user = User.new(email: "bad@example.com", password: "secret123", username: "not valid!")
    assert_not user.valid?
    assert_includes user.errors[:username], "must start with a letter or number, and may only contain letters, numbers, underscores, and hyphens"
  end

  test "username accepts uppercase letters" do
    user = User.new(email: "cased@example.com", password: "secret123", username: "CoolName")
    assert user.valid?
  end

  test "find_by_username finds a user regardless of the casing looked up" do
    user = users(:one)
    assert_equal user, User.find_by_username(user.username.upcase)
    assert_equal user, User.find_by_username(user.username.downcase)
  end

  test "find_by_username returns nil for an unknown username" do
    assert_nil User.find_by_username("no-such-user")
  end

  test "username rejects too-short values" do
    user = User.new(email: "short@example.com", password: "secret123", username: "ab")
    assert_not user.valid?
    assert_includes user.errors[:username], "is too short (minimum is 3 characters)"
  end

  test "new users get default common_docinfo" do
    user = User.create!(
      email: "defaults@example.com",
      password: "secret123"
    )

    assert_equal Project.default_docinfo.squish, user.reload.common_docinfo.squish
  end

  test "registering claims pending project invitations, without waiting for confirmation" do
    assert_not collaborations(:pending).accepted?

    user = User.create!(
      name: "Invited Person",
      email: "invited@example.com", # matches fixture collaborations(:pending)
      password: "secret123"
    )

    assert_nil user.confirmed_at, "the point of this test is an unconfirmed account"
    collaboration = collaborations(:pending).reload
    assert_equal user, collaboration.user
    assert collaboration.accepted?
    assert_includes user.shared_projects, projects(:team)
  end

  test "confirming a changed email claims invitations addressed to the new address" do
    # `reconfirmable` keeps the old address as `email` until the new one is
    # confirmed, so this invitation cannot be claimed at registration time --
    # the confirmation hook is the only thing that can catch it.
    user = users(:one)
    invitation = projects(:team).collaborations.create!(invited_email: "moved@example.com")
    assert_not invitation.accepted?

    user.update!(email: "moved@example.com")
    assert_equal "moved@example.com", user.unconfirmed_email
    user.confirm

    assert_equal user, invitation.reload.user
    assert invitation.accepted?
  end
end
