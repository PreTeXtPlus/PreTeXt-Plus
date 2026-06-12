class UsersController < ApplicationController
  require_unauthenticated_access only: [ :new, :create ]

  def new
    @user = User.new
  end

  def create
    @user = User.new(sign_up_params)
    if @user.save
      redirect_to new_user_session_path, notice: "Please check your email to confirm your account before signing in."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
    @user = current_user
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

  def sign_up_params
    params.expect(user: [ :email, :password, :name ])
  end

  def update_params
    ps = params.expect(user: [ :name, :password, :common_docinfo ])
    ps[:password].blank? ? ps.except(:password) : ps
  end
end
