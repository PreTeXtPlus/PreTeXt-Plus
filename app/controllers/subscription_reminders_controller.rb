# Flips current_user's subscription_reminders override -- see
# SubscriptionExtensions#reminders_enabled?. Kept separate from UsersController#update
# so the user lands back on whatever subscriptions page they toggled it from, with a
# message that fits, rather than on the account-settings page.
class SubscriptionRemindersController < ApplicationController
  def update
    current_user.update!(subscription_reminders: !current_user.subscription_reminders_effective?)
    message = current_user.subscription_reminders? ?
      "Reminders are on. We'll email you a few days before your subscription renews." :
      "Reminders are off."
    redirect_back_or_to subscriptions_path, notice: message
  end
end
