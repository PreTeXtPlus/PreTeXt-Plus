# Deleting your own account, and undoing that within the grace period. Singular and
# id-less like users#edit: it always acts on current_user.
#
# Requesting deletion does not delete anything yet -- see User#pending_deletion? for
# what it does do, and AccountPurgeJob for what happens once User::DELETION_GRACE_PERIOD
# has passed.
class AccountDeletionsController < ApplicationController
  skip_before_action :redirect_pending_deletion, only: %i[ show destroy ]
  before_action :require_pending_deletion, only: %i[ show destroy ]
  before_action :refuse_pending_deletion, only: %i[ new create ]
  before_action :load_warnings, only: %i[ new create ]

  # Asks for the password, so it gets the same guard against guessing as the
  # sign-in and password-reset forms.
  rate_limit to: 10, within: 3.minutes, only: :create,
             with: -> { redirect_to new_account_deletion_path, alert: "Try again later." }

  # GET /account/deletion/new -- what deleting will do, and the form to do it.
  def new
  end

  # POST /account/deletion
  def create
    if @renewing_subscriptions.any?
      return redirect_to new_account_deletion_path,
                         alert: "Cancel your subscription before deleting your account."
    end

    unless params[:acknowledge] == "1"
      flash.now[:alert] = "Please confirm that you understand what will be deleted."
      return render :new, status: :unprocessable_entity
    end

    unless current_user.valid_password?(params[:password])
      flash.now[:alert] = "That password is incorrect."
      return render :new, status: :unprocessable_entity
    end

    user = current_user
    user.request_deletion!
    AccountMailer.deletion_requested(user).deliver_later
    sign_out user

    redirect_to new_user_session_path,
                notice: "Your account has been deleted. You can still sign in to reactivate it " \
                        "until #{user.purge_at.in_time_zone.strftime('%B %-d, %Y')}."
  end

  # GET /account/deletion -- where a pending account lands after signing in.
  def show
  end

  # DELETE /account/deletion -- reactivates the account.
  def destroy
    current_user.cancel_deletion!
    redirect_to projects_path, notice: "Welcome back! Your account has been reactivated."
  end

  private

  def require_pending_deletion
    redirect_to edit_user_path(current_user) unless current_user.pending_deletion?
  end

  def refuse_pending_deletion
    redirect_to account_deletion_path if current_user.pending_deletion?
  end

  # Everything the warnings page spells out, so nothing about it comes as a surprise.
  def load_warnings
    @projects = current_user.projects.includes(:collaborators, :targets).to_a
    @shared_projects = @projects.select { |p| p.collaborators.any? }
    @published_targets = @projects.flat_map { |p| p.targets.select(&:published?) }
    @renewing_subscriptions = current_user.renewing_subscriptions
    # Seats this user's subscriptions give to *other* people, which end with them.
    @seats_for_others = SubscriptionSeat
      .where(pay_subscription_id: current_user.pay_subscriptions.select(:id))
      .where.not(user_id: current_user.id)
      .count
  end
end
