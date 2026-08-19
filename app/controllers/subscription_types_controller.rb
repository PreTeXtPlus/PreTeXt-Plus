class SubscriptionTypesController < ApplicationController
  before_action :require_admin, except: %i[ checkout new_invoice invoice ]
  before_action :set_subscription_type, only: %i[ show edit update destroy checkout new_invoice invoice ]

  # GET /subscription_types or /subscription_types.json
  def index
    @subscription_types = SubscriptionType.all
  end

  # GET /subscription_types/1 or /subscription_types/1.json
  def show
  end

  # GET /subscription_types/new
  def new
    @subscription_type = SubscriptionType.new
  end

  # GET /subscription_types/1/edit
  def edit
  end

  # POST /subscription_types or /subscription_types.json
  def create
    @subscription_type = SubscriptionType.new(subscription_type_params)

    if @subscription_type.save
      redirect_to @subscription_type, notice: "Subscription type was successfully created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  # PATCH/PUT /subscription_types/1 or /subscription_types/1.json
  def update
    if @subscription_type.update(subscription_type_params)
      redirect_to @subscription_type, notice: "Subscription type was successfully updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  # DELETE /subscription_types/1 or /subscription_types/1.json
  def destroy
    @subscription_type.destroy!
    redirect_to subscription_types_path, notice: "Subscription type was successfully destroyed.", status: :see_other
  end

  def checkout
    redirect_to checkout_url, allow_other_host: true, status: :see_other
  end

  # GET /subscription_types/1/invoice
  def new_invoice
    unless @subscription_type.invoiceable? && @subscription_type.can_be_subscribed?
      redirect_to subscriptions_path, alert: "#{@subscription_type.name} is not payable by invoice."
    end
  end

  # POST /subscription_types/1/invoice
  #
  # Direct self-serve pay-by-invoice: creates a real Stripe subscription with
  # collection_method: "send_invoice" via the pay gem's API, the same mechanism
  # Admin::SubscriptionsController#create uses on the admin's behalf. Replaces the
  # old flow where this button only emailed support to set the subscription up by
  # hand -- Stripe emails the invoice directly, and access begins once it's paid.
  def invoice
    unless @subscription_type.invoiceable? && @subscription_type.can_be_subscribed?
      return redirect_to subscriptions_path, alert: "#{@subscription_type.name} is not payable by invoice."
    end

    quantity = params[:quantity].to_i.clamp(1, 999)
    current_user.payment_processor.subscribe(
      name: Pay.default_product_name,
      plan: @subscription_type.stripe_price_id,
      quantity: quantity,
      collection_method: "send_invoice",
      days_until_due: 30
    )
    redirect_to subscriptions_path, notice: "Subscribed! An invoice for #{quantity} seat(s) has been sent to your email — access begins once it's paid."
  rescue Pay::Stripe::Error => e
    redirect_to subscriptions_path, alert: "Could not create invoiced subscription: #{e.message}"
  end

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_subscription_type
      @subscription_type = SubscriptionType.find(params.expect(:id))
    end

    # Only allow a list of trusted parameters through.
    def subscription_type_params
      params.expect(subscription_type: [ :name, :description, :bulletpoints, :stripe_price_id, :order, :trial_date, :invoiceable ])
    end

    def checkout_url
      return subscriptions_url if Rails.env.development?
      return_url = "https://#{request.host}/subscriptions"
      current_user.payment_processor.checkout(
        mode: "subscription",
        line_items: [ {
          price: @subscription_type.stripe_price_id,
          quantity: 1,
          adjustable_quantity: { enabled: true }
        } ],
        subscription_data: {
          trial_period_days: @subscription_type.trial_days > 0 ? @subscription_type.trial_days : nil
        },
        success_url: "#{return_url}?sync=true",
        cancel_url: return_url,
        billing_address_collection: "auto",
        allow_promotion_codes: false
      ).url
    end
end
