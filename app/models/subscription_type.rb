class SubscriptionType < ApplicationRecord
  after_commit :normalize_orders

  def bulletpoints_list
    bulletpoints.to_s.split("\n").map(&:strip).reject(&:empty?)
  end

  def can_be_subscribed?
    stripe_price_id.present?
  end

  def stripe_price
    Stripe::Price.retrieve(stripe_price_id)
  end

  def price
    return "Free!" if stripe_price_id.blank?
    ActiveSupport::NumberHelper.number_to_currency(stripe_price.unit_amount / 100.0, unit: "$", precision: 0)
  end

  def recurrence
    return nil if stripe_price_id.blank?
    stripe_price.recurring.interval
  end

  private
    def normalize_orders
      if order.present?
        SubscriptionType.all.order(order: :asc).each.with_index do |subscription_type, index|
          subscription_type.update_columns(order: index)
        end
      end
    end
end
