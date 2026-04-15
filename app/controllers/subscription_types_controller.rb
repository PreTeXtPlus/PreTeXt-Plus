class SubscriptionTypesController < ApplicationController
  before_action :require_admin
  before_action :set_subscription_type, only: %i[ show edit update destroy checkout ]

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
    redirect_to checkout_url("https://#{request.host}/session"), allow_other_host: true, status: :see_other
  end

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_subscription_type
      @subscription_type = SubscriptionType.find(params.expect(:id))
    end

    # Only allow a list of trusted parameters through.
    def subscription_type_params
      params.expect(subscription_type: [ :name, :description, :bulletpoints, :stripe_price_id, :order ])
    end

    def checkout_url(success_url)
      StripeCheckout.new(@current_user, @subscription_type, success_url).url
    end
end
