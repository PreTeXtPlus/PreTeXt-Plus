require "test_helper"

class RequestTest < ActiveSupport::TestCase
  test "belongs to user" do
    request = requests(:one)
    assert_equal users(:one), request.user
  end

  test "can be created for a user" do
    fresh_user = User.create!(email: "fresh@example.com", password: "password")
    request = Request.new(user: fresh_user)
    assert request.valid?
  end

  test "cannot create duplicate request for same user" do
    duplicate = Request.new(user: users(:one))
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:user_id], "has already been taken"
  end

  test "requested_invitation? returns true when request exists" do
    user = users(:one)
    assert user.requested_invitation?
  end

  test "requested_invitation? returns false when no request exists" do
    user = users(:one)
    Request.where(user: user).destroy_all
    assert_not user.requested_invitation?
  end
end
