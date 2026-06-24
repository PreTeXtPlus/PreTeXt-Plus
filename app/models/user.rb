class User < ApplicationRecord
  devise :database_authenticatable, :recoverable, :rememberable, :validatable,
         :confirmable, :trackable

  has_many :projects, dependent: :destroy
  has_many :library_assets, dependent: :destroy

  belongs_to :tos, class_name: "Term", required: false
  belongs_to :privacy, class_name: "Term", required: false

  pay_customer stripe_attributes: ->(pay_customer) { { metadata: { user_id: pay_customer.owner_id } } },
    default_payment_processor: :stripe
  has_many :subscription_seats

  normalizes :email, with: ->(e) { e.strip.downcase }

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

  def announcement_unsubscribe_token
    token = super
    if token.blank?
      token = SecureRandom.urlsafe_base64(32)
      update_column(:announcement_unsubscribe_token, token)
    end
    token
  end
end
