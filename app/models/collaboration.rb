# A collaborator (or pending invitation) on a project. Created by the project
# owner with just an email address: when a confirmed account already exists for
# that email the collaboration is accepted immediately; otherwise it sits
# pending (user_id nil) until someone confirms an account under that email and
# claims it (see User#after_confirmation).
class Collaboration < ApplicationRecord
  belongs_to :project
  belongs_to :user, optional: true

  normalizes :invited_email, with: ->(e) { e.strip.downcase }

  validates :invited_email, presence: true,
    format: { with: URI::MailTo::EMAIL_REGEXP, message: "is not a valid email address" }
  validates :invited_email, uniqueness: { scope: :project_id, message: "has already been invited" }
  validate :not_the_owner, if: -> { project.present? }
  # The cap applies only when adding someone new: a project already over its
  # limit (owner's subscription lapsed) keeps its existing collaborators.
  validate :within_collaborator_limit, on: :create, if: -> { project.present? }

  scope :accepted, -> { where.not(user_id: nil) }
  scope :pending, -> { where(user_id: nil) }

  # Once the last collaboration is gone the owner edits solo again, where
  # autosave writes divisions directly and a persisted shared doc would go
  # stale -- so drop it; it reseeds if collaboration resumes.
  after_destroy :reset_doc_when_last

  def accepted?
    user_id.present?
  end

  # Link every pending invitation addressed to this user's (just confirmed)
  # email. Confirmation proves address ownership, so no token is needed. An
  # invite to a project the user already collaborates on (possible when a
  # collaborator confirms a changed email that was separately invited) is
  # discarded rather than claimed, so a user never holds two rows on one
  # project.
  def self.claim_for(user)
    pending.where(invited_email: user.email).find_each do |collaboration|
      if collaboration.project.editable_by?(user)
        collaboration.destroy
      else
        collaboration.update(user: user, accepted_at: Time.current)
      end
    end
  end

  private

  def reset_doc_when_last
    project.reset_collaborative_doc! if project.collaborations.none?
  end

  def not_the_owner
    if invited_email == project.user.email
      errors.add(:invited_email, "already owns this project")
    end
  end

  def within_collaborator_limit
    if project.collaborations.count >= project.collaborator_limit
      errors.add(:base, "Collaborator limit (#{project.collaborator_limit}) reached for this project")
    end
  end
end
