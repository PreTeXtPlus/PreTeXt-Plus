require "test_helper"

class StudentBenefitsControllerTest < ActionDispatch::IntegrationTest
  VALID_PARAMS = { name: "Ada Lovelace", school_name: "Example University", school_email: "1", enrolled: "1" }.freeze

  test "the form and its submission both live at /students" do
    assert_equal "/students", new_student_benefits_path
    assert_equal "/students", student_benefits_path
    assert_routing({ method: :get, path: "/students" }, { controller: "student_benefits", action: "new" })
    assert_routing({ method: :post, path: "/students" }, { controller: "student_benefits", action: "create" })
  end

  test "requires sign-in" do
    get new_student_benefits_path
    assert_redirected_to new_user_session_path

    post_attestation
    assert_redirected_to new_user_session_path
  end

  test "requires a confirmed email" do
    user = users(:unconfirmed)
    user.update_columns(confirmation_sent_at: Time.current)
    sign_in user

    post_attestation

    assert_redirected_to projects_path
    assert_nil user.reload.student_benefits_until
  end

  test "form shows the account email and today's date" do
    sign_in users(:one)

    get new_student_benefits_path

    assert_response :success
    assert_includes response.body, users(:one).email
    assert_includes response.body, Time.current.strftime("%B %-d, %Y")
  end

  test "valid attestation grants one year without saving the school name" do
    user = users(:one)
    sign_in user

    freeze_time do
      post_attestation

      assert_redirected_to subscriptions_path
      assert_equal 1.year.from_now, user.reload.student_benefits_until
    end
    assert_not_includes user.attributes.values.join, VALID_PARAMS[:school_name]
  end

  test "form starts with the user's current name" do
    sign_in users(:one)

    get new_student_benefits_path

    assert_select "input[name=?][value=?]", "student_attestation[name]", users(:one).name
  end

  test "valid attestation updates the user's name, tidying whitespace" do
    user = users(:one)
    sign_in user

    post_attestation(VALID_PARAMS.merge(name: "  Ada   Lovelace "))

    assert_redirected_to subscriptions_path
    assert_equal "Ada Lovelace", user.reload.name
  end

  test "a one-word name is rejected" do
    assert_rejected VALID_PARAMS.merge(name: "Ada")
  end

  test "a blank name is rejected" do
    assert_rejected VALID_PARAMS.merge(name: "   ")
  end

  test "a two-character school name is rejected, not counting surrounding spaces" do
    assert_rejected VALID_PARAMS.merge(school_name: "  CU  ")
  end

  test "a three-character school name is accepted" do
    user = users(:one)
    sign_in user

    post_attestation(VALID_PARAMS.merge(school_name: "MIT"))

    assert_redirected_to subscriptions_path
    assert user.reload.student_benefits?
  end

  test "blank school name is rejected" do
    assert_rejected VALID_PARAMS.merge(school_name: "   ")
  end

  test "unticked school email box is rejected" do
    assert_rejected VALID_PARAMS.merge(school_email: "0")
  end

  test "unticked enrollment box is rejected" do
    assert_rejected VALID_PARAMS.merge(enrolled: "0")
  end

  test "an active student can't extend their term" do
    user = users(:one)
    until_date = 1.month.from_now.change(usec: 0)
    user.update!(student_benefits_until: until_date)
    sign_in user

    post_attestation

    assert_redirected_to subscriptions_path
    assert_equal until_date, user.reload.student_benefits_until
  end

  test "a paid subscriber can't claim" do
    user = users(:subscribed)
    sign_in user

    post_attestation

    assert_redirected_to subscriptions_path
    assert_nil user.reload.student_benefits_until
  end

  test "an expired student can claim again" do
    user = users(:one)
    user.update!(student_benefits_until: 1.day.ago)
    sign_in user

    post_attestation

    assert_redirected_to subscriptions_path
    assert user.reload.student_benefits?
  end

  private

    def post_attestation(attestation = VALID_PARAMS)
      post student_benefits_path, params: { student_attestation: attestation }
    end

    def assert_rejected(attestation)
      user = users(:one)
      sign_in user

      post_attestation(attestation)

      name_before = user.name
      assert_response :unprocessable_entity
      assert_nil user.reload.student_benefits_until
      assert_equal name_before, user.name
    end
end
