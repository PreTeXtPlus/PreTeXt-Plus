class Users::ConfirmationsController < Devise::ConfirmationsController
  def new
    if user_signed_in? && current_user.confirmed?
      redirect_to projects_path, notice: "Your account is already confirmed."
    else
      super
    end
  end

  protected

  def after_resending_confirmation_instructions_path_for(_)
    user_signed_in? ? projects_path : new_session_path(:user)
  end
end
