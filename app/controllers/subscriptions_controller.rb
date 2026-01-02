class SubscriptionsController < ApplicationController
  before_action :setup_event, only: [ :webhooks ]
  before_action :setup_payload, only: [ :webhooks ]
  before_action :setup_signature_header, only: [ :webhooks ]
  before_action :setup_endpoint_secret, only: [ :webhooks ]

  def subscribe
    require "stripe"
    Stripe.api_key = ENV["STRIPE_SECRET_KEY"]
    success_url = "https://#{request.host}/session"
    if @current_user.stripe_checkout_session_id.blank?
      alert = CGI.escape "Your subscription has successfully been created!"
      session = Stripe::Checkout::Session.create({
        line_items: [ {
          price: "pretextplus_sustaining",
          quantity: 1
        } ],
        customer_email: @current_user.email,
        mode: "subscription",
        success_url: "#{success_url}?alert=#{alert}"
      })
    else
      alert = CGI.escape "Your subscription has been successfully managed!"
      checkout_session = Stripe::Checkout::Session.retrieve(
        @current_user.stripe_checkout_session_id
      )
      session = Stripe::BillingPortal::Session.create({
        customer: checkout_session.customer,
        return_url: "#{success_url}?alert=#{alert}"
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

    handle_event

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

  def handle_event
    case @event.type
    when "customer.subscription.updated"
      handle_subscription_updated(@event.data.object)
    else
      Rails.logger.info("Unhandled event type: #{@event.type}")
    end
  end

  def handle_subscription_updated(subscription)
    if event.type == "customer.subscription.deleted"
      # handle subscription canceled automatically based
      # upon your subscription settings. Or if the user cancels it.
      puts "Subscription canceled: #{event.id}"
    end
  end
end
