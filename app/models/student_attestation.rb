# What a student affirms to claim student benefits. Deliberately not persisted: we trust
# the answers and discard them, so the only record of a claim is
# User#student_benefits_until. The exception is name, which updates the user's own name.
class StudentAttestation
  include ActiveModel::Model
  include ActiveModel::Attributes

  MINIMUM_NAME_WORDS = 2
  MINIMUM_SCHOOL_NAME_LENGTH = 3

  attribute :name, :string
  attribute :school_name, :string
  attribute :school_email, :boolean
  attribute :enrolled, :boolean

  validate :name_has_enough_words
  validate :school_name_is_long_enough
  validates :school_email, acceptance: { accept: true, allow_nil: false, message: "Confirm that this account's email is your school email." }
  validates :enrolled, acceptance: { accept: true, allow_nil: false, message: "Confirm that you are a full-time student actively enrolled in classes." }

  def name
    super.to_s.squish
  end

  def school_name
    super.to_s.squish
  end

  private

    def name_has_enough_words
      return if name.split.size >= MINIMUM_NAME_WORDS
      errors.add(:name, "Enter your full name.")
    end

    def school_name_is_long_enough
      return if school_name.length >= MINIMUM_SCHOOL_NAME_LENGTH
      errors.add(:school_name, "Enter the full name of your school.")
    end
end
