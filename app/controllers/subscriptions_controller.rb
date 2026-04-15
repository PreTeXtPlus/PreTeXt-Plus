class SubscriptionsController < ApplicationController
  before_action :set_subscriptions
  before_action :set_subscription, only: %i[ show ]

  def index
    @current_user.payment_processor.sync_subscriptions(status: "all")
    @subscriptions = @current_user.payment_processor.subscriptions
  end
  def show
  end

  private

    def set_subscriptions
      @subscriptions = @current_user.payment_processor.subscriptions
    end
    def set_subscription
      @subscription = Pay::Stripe::Subscription.find(params.expect(:id))
    end
end
