class InvitationsController < ApplicationController
  def new
    unless @current_user.admin
      redirect_to projects_path, alert: "You are not authorized"
    end
  end

  def create
    u = User.find_by email: params[:email]
    unless u.present?
      flash[:notice] = "User with email #{params[:email]} does not exist"
      render :new, status: :unprocessable_entity
    end
    amount = params[:amount].to_i
    if amount < 1
      flash[:notice] = "#{params[:amount]} is not a valid amount"
      render :new, status: :unprocessable_entity
    end
    amount = [ amount, 100 ].min
    amount.times do
      u.invitations.create!
    end
    redirect_to projects_path, notice: "Created #{amount} invitations for #{u.email}"
  end
end
