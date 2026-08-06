class SubscriptionType < ApplicationRecord
  after_commit :normalize_orders
  validate :trial_date_format

  def bulletpoints_list
    bulletpoints.to_s.split("\n").map(&:strip).reject(&:empty?)
  end

  def can_be_subscribed?
    stripe_price_id.present?
  end

  def stripe_price
    return nil if stripe_price_id.blank? || Rails.env.test?
    return mock_stripe_price if Rails.env.development?

    data = Rails.cache.fetch("subscription_type/stripe_price/#{stripe_price_id}", expires_in: 1.hour) do
      price = Stripe::Price.retrieve(stripe_price_id)
      { unit_amount: price.unit_amount, interval: price.recurring&.interval }
    end

    build_price_struct(data[:unit_amount], data[:interval])
  end

  def price
    return "Free!" if stripe_price.blank?
    ActiveSupport::NumberHelper.number_to_currency(stripe_price.unit_amount / 100.0, unit: "$", precision: 0)
  end

  def recurrence
    return nil if stripe_price.blank?
    stripe_price.recurring.interval
  end

  def trial_date_object
    return nil if trial_date.blank?
    zone = "America/New_York"
    ActiveSupport::TimeZone[zone].parse(trial_date) rescue nil
  end

  def trial_days
    return 0 if trial_date_object.blank?
    [ 0, (trial_date_object.to_date - Date.current).to_i ].max
  end

  private
    def build_price_struct(unit_amount, interval)
      recurring = Struct.new(:interval).new(interval)
      Struct.new(:unit_amount, :recurring).new(unit_amount, recurring)
    end

    def mock_stripe_price
      build_price_struct(999, "month")
    end

    def normalize_orders
      if order.present?
        SubscriptionType.all.order(order: :asc).each.with_index do |subscription_type, index|
          subscription_type.update_columns(order: index)
        end
      end
    end

    def trial_date_format
      return if trial_date.blank?
      unless trial_date.match?(/\A\d{4}-\d{2}-\d{2}\z/)
        errors.add(:trial_date, "must be in the format YYYY-MM-DD")
      end
    end
end
