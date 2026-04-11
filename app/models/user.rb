class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :projects, dependent: :destroy
  has_many :invitations, dependent: :destroy, foreign_key: "owner_user_id"

  after_create_commit :claim_intended_invitations
  after_create_commit :invite_edu_user

  enum :subscription, { beta: 0, sustaining: 1 }, default: :beta, suffix: true, validate: true

  normalizes :email, with: ->(e) { e.strip.downcase }

  validates_uniqueness_of :email
  validates :password, length: { minimum: 1 }, allow_nil: true

  def invited?
    Invitation.where(recipient_user: self).exists?
  end

  def requested_invitation?
    Request.where(user: self).exists?
  end

  def name_with_email
    if self.name.present?
      "#{self.name} <#{self.email}>"
    else
      self.email
    end
  end

  def project_quota
    return 10_000 if self.admin
    return 0 unless self.invited?
    return 100 if self.sustaining_subscription?
    10
  end

  def has_copiable_projects?
    self.sustaining_subscription? or self.admin?
  end

  private

  def claim_intended_invitations
    Invitation.where(intended_email: self.email, recipient_user_id: nil).find_each do |invitation|
      invitation.update recipient_user: self
    end
  end

  def invite_edu_user
    if self.email.end_with?(".edu") && !self.invited?
      Invitation.create! recipient_user: self, owner_user: User.find_by(admin: true)
    end
  end
end
