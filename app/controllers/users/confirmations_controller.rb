class Users::ConfirmationsController < Devise::ConfirmationsController
  def new
    if user_signed_in? && current_user.confirmed?
      redirect_to projects_path, notice: "Your account is already confirmed."
    else
      super
    end
  end

  # GET /users/confirmation?confirmation_token=...
  #
  # The emailed link only shows a "Confirm my email" button; #confirm does the
  # confirming. Mail security scanners (Microsoft Safe Links and the like) open
  # every link in an incoming message, so confirming on GET let a scanner
  # confirm an address no person had vouched for -- including one an impostor
  # signed up with -- and left the real recipient's click on Devise's "already
  # confirmed" error, which surfaced as a bare resend form (issue #366).
  # Scanners fetch links; they don't submit forms.
  #
  # Nothing here expires or consumes the link: Devise keeps the token after
  # confirming and confirm_within is unset, so it can be opened any number of
  # times, by anyone or anything, before or after the person clicks the button.
  def show
    token = params[:confirmation_token]
    self.resource = resource_class.find_first_by_auth_conditions(confirmation_token: token) if token.present?

    if resource.nil?
      self.resource = resource_class.new
      resource.errors.add(:confirmation_token, token.present? ? :invalid : :blank)
      render :new, status: :unprocessable_entity
    elsif resource.confirmed? && !resource.pending_reconfirmation?
      redirect_already_confirmed
    end
  end

  # POST /users/confirmation/confirm
  def confirm
    self.resource = resource_class.confirm_by_token(params[:confirmation_token])

    if resource.errors.empty?
      set_flash_message!(:notice, :confirmed)
      redirect_to after_confirmation_path_for(resource_name, resource)
    elsif resource.errors.of_kind?(:email, :already_confirmed)
      redirect_already_confirmed
    else
      render :new, status: :unprocessable_entity
    end
  end

  # POST /users/confirmation (resend). Devise refuses to resend to a confirmed
  # address; say so instead of re-rendering the form.
  def create
    super do |user|
      return redirect_already_confirmed if user.errors.of_kind?(:email, :already_confirmed)
    end
  end

  protected

  def after_resending_confirmation_instructions_path_for(_)
    user_signed_in? ? projects_path : new_session_path(:user)
  end

  private

  def redirect_already_confirmed
    notice = "Your email address is already confirmed."
    notice += " Please log in." unless user_signed_in?
    redirect_to user_signed_in? ? projects_path : new_session_path(:user), notice: notice
  end
end
