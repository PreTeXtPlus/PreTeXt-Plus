module SubscriptionExtensions
  extend ActiveSupport::Concern

  def type
    SubscriptionType.find_by stripe_price_id: processor_plan
  end
end
