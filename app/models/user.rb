class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :projects, dependent: :destroy

  enum :subscription, { beta: 0, sustaining: 1 }, suffix: true

  normalizes :email, with: ->(e) { e.strip.downcase }

  validates_uniqueness_of :email

  attr_accessor :invite_code

  before_create :validate_invite_code
  after_create_commit :expire_invite

  private

  def validate_invite_code
    valid_invite = Invitation.where(recipient_user_id: nil).find_by(code: invite_code)
    unless valid_invite.present?
      errors.add(:invite_code, "is invalid")
      throw :abort
    end
  end

  def expire_invite
    valid_invite = Invitation.where(recipient_user_id: nil).find_by(code: invite_code)
    unless valid_invite.present?
      errors.add(:invite_code, "is invalid")
      throw :abort
    end
    valid_invite.update!(recipient_user_id: self.id)
  end

  def pay_should_sync_customer?
    # super will invoke Pay's default (e-mail changed)
    super || self.saved_change_to_name?
  end
end
