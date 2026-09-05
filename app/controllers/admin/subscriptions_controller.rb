class Admin::SubscriptionsController < Admin::BaseController
  before_action :set_user
  before_action :set_subscription, only: [ :update_seats, :mark_invoice_paid ]

  def create
    subscription_type = SubscriptionType.find(params[:subscription_type_id])
    unless subscription_type.can_be_subscribed?
      return redirect_to admin_user_path(@user), alert: "#{subscription_type.name} has no Stripe price configured."
    end

    quantity = params[:quantity].to_i.clamp(1, 999)
    days_until_due = params[:days_until_due].presence&.to_i&.clamp(1, 365) || 30

    @user.payment_processor.subscribe(
      name: Pay.default_product_name,
      plan: subscription_type.stripe_price_id,
      quantity: quantity,
      collection_method: "send_invoice",
      days_until_due: days_until_due
    )
    redirect_to admin_user_path(@user), notice: "Created #{subscription_type.name} subscription (#{quantity} seat(s)), invoiced with #{days_until_due}-day terms."
  rescue Pay::Stripe::Error => e
    redirect_to admin_user_path(@user), alert: "Could not create subscription: #{e.message}"
  end

  def update_seats
    emails = params[:emails].to_s.split(/[\s,]+/).map(&:strip).reject(&:empty?).uniq
    if emails.size > @subscription.quantity
      return redirect_to admin_user_path(@user), alert: "Failed to update seats: this plan has #{@subscription.quantity} seat(s), but #{emails.size} email(s) were entered."
    end
    random_password = SecureRandom.alphanumeric(8)
    new_users = false
    old_seat_ids = SubscriptionSeat.where(subscription: @subscription).pluck(:id)
    emails.each do |email|
      seat_user = User.find_or_initialize_by(email: email)
      if seat_user.new_record?
        new_users = true
        seat_user.password = random_password
        seat_user.save!
      end
      SubscriptionSeat.create!(subscription: @subscription, user: seat_user)
    end
    SubscriptionSeat.where(id: old_seat_ids).destroy_all
    notice = "Seats updated."
    notice += " New account(s) created with temporary password #{random_password}." if new_users
    redirect_to admin_user_path(@user), notice: notice
  end

  def mark_invoice_paid
    invoice_id = @subscription.stripe_object&.latest_invoice&.id
    return redirect_to admin_user_path(@user), alert: "No invoice found for this subscription." if invoice_id.blank?

    invoice = Stripe::Invoice.retrieve(invoice_id)
    unless invoice.status == "open"
      return redirect_to admin_user_path(@user), alert: "Invoice #{invoice.number || invoice.id} is #{invoice.status}, not open."
    end

    paid_invoice = Stripe::Invoice.pay(invoice.id, paid_out_of_band: true)
    Pay::Stripe::Subscription.sync(@subscription.processor_id)
    AdminSubscriptionNotifier.new(
      subscription: @subscription,
      amount_cents: paid_invoice.amount_paid,
      currency: paid_invoice.currency,
      billing_reason: paid_invoice.billing_reason,
      manual: true
    ).notify!
    redirect_to admin_user_path(@user), notice: "Marked invoice #{invoice.number || invoice.id} as paid outside Stripe."
  rescue Stripe::StripeError => e
    redirect_to admin_user_path(@user), alert: "Could not mark invoice as paid: #{e.message}"
  end

  private
    def set_user
      @user = User.find(params[:user_id])
    end

    def set_subscription
      # Scoped through the user's own subscriptions association, not a bare
      # Pay::Stripe::Subscription.find, so a stale/mistyped id can't act on
      # another user's subscription.
      @subscription = @user.payment_processor.subscriptions.find(params[:id])
    end
end
