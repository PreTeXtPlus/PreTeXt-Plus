class SubscriptionsController < ApplicationController
  def index
    @subscriptions = @current_user.payment_processor.subscriptions
  end
end
