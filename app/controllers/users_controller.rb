class UsersController < ApplicationController
  require_unauthenticated_access only: [ :new, :create ]
  allow_unauthenticated_access only: [ :show ]

  # Every sign-up sends a confirmation email to whatever address was typed in, so an
  # unguarded form lets a bot use us to mail strangers. The limit is per IP address and
  # deliberately roomy: a workshop or a classroom signs up together from one address.
  rate_limit to: 30, within: 1.hour, only: :create,
             with: -> { redirect_to new_user_path, alert: "Too many accounts have been created from your network. Please try again later." }
  before_action :reject_honeypot, only: :create

  # A field people never see (see users/new) but form-filling bots complete.
  HONEYPOT_FIELD = :company_website

  def new
    @user = User.new
  end

  def create
    @user = User.new(sign_up_params)
    if @user.save
      sign_in(:user, @user)
      redirect_to projects_path,
                  notice: "Please check your email to confirm your account. " \
                          "Accounts that are not confirmed and have no projects are deleted after #{User::UNCONFIRMED_RETENTION.in_days.to_i} days."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
    @user = current_user
  end

  # GET /users/:username
  # Public profile: lists a user's publicly-visible projects. An unsubscribed
  # owner can still see their own page (so they can preview it before subscribing),
  # but no one else can. NotFound rather than Forbidden so a private profile
  # doesn't confirm to a stranger that the username exists.
  def show
    @profile_user = User.find_by_username(params[:username])
    raise ActiveRecord::RecordNotFound unless @profile_user && profile_visible?(@profile_user)

    # Each card lists its own published targets, so eager-load them rather than
    # querying per project.
    @projects = @profile_user.projects.publicly_listed.includes(:targets)
  end

  def update
    @user = current_user
    if @user.update(update_params)
      redirect_to edit_user_path(@user), notice: "Account updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  private

  def profile_visible?(profile_user)
    return false if profile_user.pending_deletion?
    current_user == profile_user || profile_user.has_subscriber_benefits?
  end

  # Nothing is created and no email is sent. The message is honest rather than a fake
  # success in case a browser extension, not a bot, filled the field in.
  def reject_honeypot
    return if params[HONEYPOT_FIELD].blank?
    redirect_to new_user_path, alert: "We couldn't create your account. Please try again."
  end

  def sign_up_params
    params.expect(user: [ :email, :password, :name ])
  end

  def update_params
    ps = params.expect(user: [ :name, :password, :common_docinfo, :username, :subscription_reminders ])
    ps[:password].blank? ? ps.except(:password) : ps
  end
end
