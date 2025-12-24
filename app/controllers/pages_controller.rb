class PagesController < ApplicationController
  allow_unauthenticated_access only: :home
  def home
    render layout: false
  end

  def subscribe
    require "stripe"
    Stripe.api_key = ENV["STRIPE_SECRET_KEY"]
    success_url = "https://#{request.host}/session"
    if @current_user.stripe_checkout_session_id.blank?
      session = Stripe::Checkout::Session.create({
        line_items: [ {
          price: "pretextplus_sustaining",
          quantity: 1
        } ],
        customer_email: @current_user.email,
        mode: "subscription",
        success_url: success_url
      })
    else
      checkout_session = Stripe::Checkout::Session.retrieve(
        @current_user.stripe_checkout_session_id
      )
      session = Stripe::BillingPortal::Session.create({
        customer: checkout_session.customer,
        return_url: @current_user.stripe_checkout_session_id
      })
    end
    redirect_to session.url, allow_other_host: true
  end
end
