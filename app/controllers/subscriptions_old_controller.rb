class SubscriptionsController < ApplicationController
  before_action :setup_event, only: [ :webhooks ]
  before_action :setup_payload, only: [ :webhooks ]
  before_action :setup_signature_header, only: [ :webhooks ]
  before_action :setup_endpoint_secret, only: [ :webhooks ]
  skip_before_action :verify_authenticity_token, only: [ :webhooks ]
  allow_unauthenticated_access only: :webhooks

  def subscribe
    require "stripe"
    Stripe.api_key = ENV["STRIPE_SECRET_KEY"]
    success_url = "https://#{request.host}/session"
    if @current_user.stripe_checkout_session_id.blank?
      notice = CGI.escape "Your subscription has successfully been created!"
      session = Stripe::Checkout::Session.create({
        line_items: [ {
          price: ENV["STRIPE_SUSTAINING_PRICE"],
          quantity: 1
        } ],
        customer_email: @current_user.email,
        mode: "subscription",
        success_url: "#{success_url}?notice=#{notice}"
      })
      @current_user.update stripe_checkout_session_id: session.id
    else
      notice = CGI.escape "Your subscription has been successfully managed!"
      checkout_session = Stripe::Checkout::Session.retrieve(
        @current_user.stripe_checkout_session_id
      )
      session = Stripe::BillingPortal::Session.create({
        customer: checkout_session.customer,
        return_url: "#{success_url}?notice=#{notice}"
      })
    end
    redirect_to session.url, allow_other_host: true
  end

  def webhooks
    begin
      @event = Stripe::Webhook.construct_event(
        @payload, @signature_header, @endpoint_secret
      )
    rescue JSON::ParserError => _e
      render json: { error: "Invalid payload" }, status: 400 and return
    rescue Stripe::SignatureVerificationError => _e
      render json: { error: "Invalid signature" }, status: 400 and return
    end


    case @event.type
    when "customer.created"
      customer = @event.data.object
      user = User.find_by email: customer.email
      if user.present?
        user.update stripe_customer_id: customer.id
      else
        render json: { error: "Invalid customer" }, status: 400 and return
      end
    when "customer.subscription.created"
      customer_id = @event.data.object.customer
      user = User.find_by stripe_customer_id: customer_id
      if user.present?
        user.update subscription: :sustaining
        10.times { user.invitations.create }
      else
        render json: { error: "Invalid customer" }, status: 400 and return
      end
    when "customer.subscription.deleted"
      customer_id = @event.data.object.customer
      user = User.find_by stripe_customer_id: customer_id
      if user.present?
        user.update subscription: :beta
      else
        render json: { error: "Invalid customer" }, status: 400 and return
      end
    else
      Rails.logger.info("Unhandled event type: #{@event.type}")
    end

    render json: { message: "Success" }, status: 200
  end

  private

  def setup_event
    @event = nil
  end

  def setup_payload
    @payload = request.body.read
  end

  def setup_signature_header
    @signature_header = request.env["HTTP_STRIPE_SIGNATURE"]
  end

  def setup_endpoint_secret
    @endpoint_secret = ENV["STRIPE_WEBHOOK_SECRET"]
  end
end
