class Term < ApplicationRecord
  enum :policy_type, { tos: 0, privacy: 1 }, default: :tos, validate: true

  def self.current(policy_type)
    self.where(policy_type: policy_type).order(created_at: :desc).first
  end
end
