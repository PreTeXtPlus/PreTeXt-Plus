class SubscriptionType < ApplicationRecord
  after_commit :normalize_orders

  def bulletpoints_list
    bulletpoints.to_s.split("\n").map(&:strip).reject(&:empty?)
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
