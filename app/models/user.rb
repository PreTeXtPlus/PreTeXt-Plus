class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :projects, dependent: :destroy

  normalizes :email_address, with: ->(e) { e.strip.downcase }

  validates_uniqueness_of :email_address

  attr_accessor :invite_code

  before_create :validate_invite_code
  after_create_commit :expire_invite

  private

  def validate_invite_code
    return if User.all.count == 1  # first user doesn't need invite
    valid_invite = Invitation.where(recipient_user_id: nil).find_by(code: invite_code)
    unless valid_invite.present?
      errors.add(:invite_code, "is invalid")
      throw :abort
    end
  end

  def expire_invite
    return if User.all.count == 1  # first user doesn't need invite
    valid_invite = Invitation.where(recipient_user_id: nil).find_by(code: invite_code)
    unless valid_invite.present?
      errors.add(:invite_code, "is invalid")
      throw :abort
    end
    valid_invite.update!(recipient_user_id: self.id)
  end
end
