class SubscriptionsController < ApplicationController
  before_action :set_subscriptions
  before_action :set_subscription, only: %i[ show seat ]
  before_action :authorize_subscription, only: %i[ show seat ]

  def index
    if params[:sync] == "true"
      @current_user.payment_processor.sync_subscriptions(status: "all")
    end
    @subscriptions = @current_user.payment_processor.subscriptions
  end

  def show
    @emails = @subscription.seated_users.map(&:email).join("\n")
    @random_password = params[:random_password]
  end

  def seat
    random_password = SecureRandom.alphanumeric 8
    emails = params[:emails].to_s.split(/[\s,]+/).map(&:strip).reject(&:empty?).uniq
    if emails.size > @subscription.quantity
      return redirect_to subscription_path(@subscription), alert: "Failed to update. You only have #{@subscription.quantity} seats, but you entered #{emails.size} emails."
    end
    new_users = false
    old_seat_ids = SubscriptionSeat.where(subscription: @subscription).pluck(:id)
    emails.each do |email|
      user = User.find_or_initialize_by(email: email)
      if user.new_record?
        new_users = true
        user.password = random_password
        user.save!
      end
      SubscriptionSeat.create!(subscription: @subscription, user: user)
    end
    random_password = nil unless new_users
    SubscriptionSeat.where(id: old_seat_ids).destroy_all
    redirect_to subscription_path(@subscription, random_password: random_password), notice: "Seats updated."
  end

  private

    def set_subscriptions
      @subscriptions = @current_user.payment_processor.subscriptions
    end
    def set_subscription
      @subscription = Pay::Stripe::Subscription.find(params.expect(:id))
    end
    def authorize_subscription
      unless @subscription.user == @current_user
        redirect_to subscriptions_path, alert: "You are not authorized to view that subscription."
      end
    end
end
