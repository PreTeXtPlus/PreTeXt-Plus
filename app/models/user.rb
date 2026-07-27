class User < ApplicationRecord
  devise :database_authenticatable, :recoverable, :rememberable, :validatable,
         :confirmable, :trackable

  has_many :projects, dependent: :destroy
  has_many :assets, through: :projects

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

  def project_quota
    return 10_000 if admin
    return 100 if subscribed?
    10
  end

  # Outputs per project. Unlike project_quota this is a cost bound rather than a plan
  # feature: every target is something an author can ask the build server to run.
  def target_quota
    return 50 if admin
    return 12 if subscribed?
    3
  end

  def upload_mb_quota
    return 1_000 if admin
    return 100 if subscribed?
    20
  end

  def has_copiable_projects?
    subscribed? || admin
  end

  def update_terms
    update(tos: Term.current(:tos), privacy: Term.current(:privacy))
  end

  private

  def set_common_docinfo
    self.common_docinfo = Project.default_docinfo if self.common_docinfo.blank?
  end
end
