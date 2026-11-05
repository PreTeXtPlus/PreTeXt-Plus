class AddStudentBenefitsUntilToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :student_benefits_until, :datetime
  end
end
