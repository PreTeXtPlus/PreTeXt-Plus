class Invitation < ApplicationRecord
  belongs_to :owner_user, class_name: "User"
  belongs_to :recipient_user, class_name: "User", required: false

  before_save :fill_intended_email

  validate :intended_email_matches_recipient

  def used?
    recipient_user_id.present?
  end

  def self.create_from_first_user
    self.create owner_user: User.first
  end

  private

  def fill_intended_email
    if self.recipient_user.present? and self.intended_email.blank?
      self.intended_email = self.recipient_user.email
    end
  end

  def intended_email_matches_recipient
    if self.recipient_user.present? and self.intended_email.present?
      if self.recipient_user.email != self.intended_email
        errors.add :intended_email, "does not match the recipient user's email"
      end
    end
  end
end
