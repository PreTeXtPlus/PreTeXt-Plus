class UsersController < ApplicationController
  require_unauthenticated_access only: [ :new, :create ]
  allow_unauthenticated_access only: [ :show ]

  def new
    @user = User.new
  end

  def create
    @user = User.new(sign_up_params)
    if @user.save
      sign_in(:user, @user)
      redirect_to projects_path, notice: "Please check your email to confirm your account."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
    @user = current_user
  end

  # GET /users/:username
  # Public profile: lists a user's publicly-visible projects. Kept behind the same
  # subscriber gate as has_copiable_projects? everywhere else -- an unsubscribed
  # owner can still see their own page (so they can preview it before subscribing),
  # but no one else can. NotFound rather than Forbidden so a private profile
  # doesn't confirm to a stranger that the username exists.
  def show
    @profile_user = User.find_by_username(params[:username])
    raise ActiveRecord::RecordNotFound unless @profile_user && profile_visible?(@profile_user)

    @projects = @profile_user.projects.publicly_listed
  end

  def update
    @user = current_user
    if @user.update(update_params)
      redirect_to edit_user_path(@user), notice: "Profile successfully updated!"
    else
      render :edit, status: :unprocessable_entity
    end
  end

  private

  def profile_visible?(profile_user)
    current_user == profile_user || profile_user.has_copiable_projects?
  end

  def sign_up_params
    params.expect(user: [ :email, :password, :name ])
  end

  def update_params
    ps = params.expect(user: [ :name, :password, :common_docinfo, :username ])
    ps[:password].blank? ? ps.except(:password) : ps
  end
end
