require "test_helper"

class InvitationTest < ActiveSupport::TestCase
  test "used? returns true when recipient_user is set" do
    invitation = invitations(:one)
    assert invitation.used?
  end

  test "used? returns false when no recipient_user" do
    invitation = Invitation.new(owner_user: users(:one))
    assert_not invitation.used?
  end

  test "fill_intended_email sets intended_email from recipient on save" do
    user = users(:two)
    invitation = Invitation.new(owner_user: users(:one), recipient_user: user)
    invitation.save!
    assert_equal user.email, invitation.intended_email
  end

  test "intended_email_matches_recipient validation fails when emails differ" do
    user = users(:two)
    invitation = Invitation.new(
      owner_user: users(:one),
      recipient_user: user,
      intended_email: "wrong@example.com"
    )
    assert_not invitation.valid?
    assert invitation.errors[:intended_email].any?
  end

  test "intended_email_matches_recipient passes when emails match" do
    user = users(:two)
    invitation = Invitation.new(
      owner_user: users(:one),
      recipient_user: user,
      intended_email: user.email
    )
    assert invitation.valid?
  end

  test "create_from_first_user creates an invitation owned by the first user" do
    invitation = Invitation.create_from_first_user
    assert_equal User.first, invitation.owner_user
  end

  test "creating invitation for recipient destroys existing access requests" do
    user = users(:two)
    request = Request.find_by(user: user) || Request.create!(user: user)
    invitation = Invitation.create!(owner_user: users(:one), recipient_user: user)
    invitation.send(:destroy_old_requests)
    assert_not Request.exists?(user: user)
  end
end
