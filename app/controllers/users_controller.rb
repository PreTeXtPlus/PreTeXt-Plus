class UsersController < ApplicationController
  require_unauthenticated_access only: [ :new, :create ]

  def new
    @user = User.new
  end

  def create
    @user = User.new(sign_up_params)
    if @user.save
      start_new_session_for(@user)
      redirect_to projects_path, notice: "Welcome to PreTeXt.Plus!"
    else
      render :new, status: :unprocessable_entity
    end
  end

  def update
    if @current_user.update(update_params)
      redirect_to projects_path, notice: "Profile successfully updated!"
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

  def sign_up_params
    params.expect(user: [ :email, :password, :name ])
  end

  def update_params
    params.expect(user: [ :name ])
  end
end
