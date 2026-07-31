class User < ApplicationRecord
  # The top of the publisher-options chain: an author's defaults for every project they
  # own. See Publication::Settings for how the three levels resolve.
  include HasPublicationSettings

  devise :database_authenticatable, :recoverable, :rememberable, :validatable,
         :confirmable, :trackable

  has_many :projects, dependent: :destroy
  has_many :assets, through: :projects

  # Projects this user collaborates on (owned by someone else). A collaboration
  # row with a user_id is accepted by definition -- pending invites have no
  # user yet -- so no scoping is needed here. Destroying the rows on account
  # deletion just removes this user from those projects.
  has_many :collaborations, dependent: :destroy
  has_many :shared_projects, through: :collaborations, source: :project

  belongs_to :tos, class_name: "Term", required: false
  belongs_to :privacy, class_name: "Term", required: false

  pay_customer stripe_attributes: ->(pay_customer) { { metadata: { user_id: pay_customer.owner_id } } },
    default_payment_processor: :stripe
  has_many :subscription_seats

  normalizes :email, with: ->(e) { e.strip.downcase }
  # Casing is kept (a vanity name is part of the point) -- blank -> nil rather than
  # "": an empty string would still trip the uniqueness index the moment a second
  # user left the field blank.
  normalizes :username, with: ->(u) { u.strip.presence }

  # case_sensitive: false so "Alice" and "alice" collide despite both being kept
  # verbatim; index_users_on_lower_username backs this at the database level too,
  # since the app-level check alone would race under concurrent signups.
  validates :username,
    uniqueness: { case_sensitive: false },
    length: { minimum: 3, maximum: 30 },
    format: { with: /\A[a-zA-Z0-9][a-zA-Z0-9_-]*\z/,
              message: "must start with a letter or number, and may only contain letters, numbers, underscores, and hyphens" },
    allow_nil: true

  before_create :set_common_docinfo
  after_create :claim_project_invitations

  # Case-insensitive counterpart to find_by(username:) -- a profile URL should
  # resolve regardless of how the visitor cased it, matching the uniqueness rule
  # above and the lower(username) index it relies on.
  def self.find_by_username(username)
    find_by("lower(username) = ?", username.to_s.strip.downcase)
  end

  def subscribed?
    self.subscription_seats.any? { |s| s.grants_privileges? }
  end

  def subscribed_until
    active_seats = self.subscription_seats.select { |s| s.grants_privileges? }
    return nil if active_seats.empty?
    active_seats.map { |s| s.subscription.current_period_end }.max
  end

  def name_with_email
    if self.name.present?
      "#{self.name} <#{self.email}>"
    else
      self.email
    end
  end

  # Outputs per project. Unlike asset_quota this is a cost bound rather than a plan
  # feature: every target is something an author can ask the build server to run.
  def target_quota
    return 12 if has_subscriber_benefits?
    3
  end

  # Total assets across every project the user owns -- a single pool for the
  # whole account, not per-project, since assets are the actual storage cost.
  def asset_quota
    return Float::INFINITY if has_subscriber_benefits?
    100
  end

  def has_subscriber_benefits?
    subscribed? || admin
  end

  def has_profile_page?
    username.present?
  end

  def update_terms
    update(tos: Term.current(:tos), privacy: Term.current(:privacy))
  end

  private

  # Registering is enough to pick up invitations already addressed to you: a
  # collaborator only has to be a registered user, not a confirmed one (see
  # CollaborationsController#create). Without this, an invite sent *before*
  # someone signed up would strand them until they confirmed, which is the same
  # inconsistency from the other direction.
  def claim_project_invitations
    Collaboration.claim_for(self)
  end

  # Devise (confirmable) hook: runs whenever this user confirms an email address.
  # Still needed alongside the create hook because `reconfirmable` means a
  # *changed* address only becomes this user's `email` once confirmed, so an
  # invitation sent to the new address can only be claimed here.
  def after_confirmation
    super
    claim_project_invitations
  end

  def set_common_docinfo
    self.common_docinfo = Project.default_docinfo if self.common_docinfo.blank?
  end
end
