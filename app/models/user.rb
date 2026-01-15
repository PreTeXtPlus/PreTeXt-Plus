class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :projects, dependent: :destroy
  has_many :invitations, dependent: :destroy, foreign_key: "owner_user_id"

  enum :subscription, { beta: 0, sustaining: 1 }, suffix: true

  normalizes :email, with: ->(e) { e.strip.downcase }

  validates_uniqueness_of :email

  def invited?
    Invitation.where(recipient_user: self).exists?
  end

  def project_quota
    return 10_000 if self.admin
    return 0 unless self.invited?
    return 100 if self.sustaining_subscription?
    10
  end
end
