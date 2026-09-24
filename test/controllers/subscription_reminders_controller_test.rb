require "test_helper"

class SubscriptionRemindersControllerTest < ActionDispatch::IntegrationTest
  test "redirects unauthenticated requests to sign in" do
    patch subscription_reminders_path
    assert_redirected_to new_user_session_path
  end

  test "turns reminders on when currently off" do
    sign_in users(:subscribed)
    assert_not users(:subscribed).subscription_reminders_effective?

    patch subscription_reminders_path

    assert_redirected_to subscriptions_path
    assert_equal "Reminders are on. We'll email you a few days before your subscription renews.", flash[:notice]
    assert_equal true, users(:subscribed).reload.subscription_reminders
  end

  test "turns reminders off when currently on" do
    users(:subscribed).update!(subscription_reminders: true)
    sign_in users(:subscribed)

    patch subscription_reminders_path

    assert_redirected_to subscriptions_path
    assert_equal "Reminders are off.", flash[:notice]
    assert_equal false, users(:subscribed).reload.subscription_reminders
  end

  test "redirects back to the referring page" do
    sign_in users(:subscribed)

    patch subscription_reminders_path, headers: { "HTTP_REFERER" => subscription_url(pay_subscriptions(:one)) }

    assert_redirected_to subscription_url(pay_subscriptions(:one))
  end
end
