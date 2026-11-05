# What a student affirms to claim student benefits. Deliberately not persisted: we trust
# the answers and discard them, so the only record of a claim is
# User#student_benefits_until.
class StudentAttestation
  include ActiveModel::Model
  include ActiveModel::Attributes

  attribute :school_name, :string
  attribute :school_email, :boolean
  attribute :enrolled, :boolean

  validates :school_name, presence: { message: "Enter the name of your school." }
  validates :school_email, acceptance: { accept: true, allow_nil: false, message: "Confirm that this account's email is your school email." }
  validates :enrolled, acceptance: { accept: true, allow_nil: false, message: "Confirm that you are a full-time student actively enrolled in classes." }
end
