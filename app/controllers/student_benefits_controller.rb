class StudentBenefitsController < ApplicationController
  before_action :require_confirmed_email
  before_action :require_availability

  def new
    @attestation = StudentAttestation.new(name: current_user.name)
  end

  def create
    @attestation = StudentAttestation.new(params.expect(student_attestation: [ :name, :school_name, :school_email, :enrolled ]))

    if @attestation.valid?
      current_user.grant_student_benefits!(name: @attestation.name)
      redirect_to subscriptions_path, notice: "You've been approved and your student benefits are now active!"
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

    def require_availability
      return if current_user.student_benefits_available?
      redirect_to subscriptions_path, alert: "Student benefits aren't available while you have an active subscription or student benefits."
    end
end
