class InvitationsController < ApplicationController
  def new
    unless @current_user.admin
      redirect_to projects_path, alert: "You are not authorized"
    end
  end

  def create
    mode = params[:mode]
    if mode == "for_user"
      u = User.find_by email: params[:email]
      unless u.present?
        flash[:notice] = "User with email #{params[:email]} does not exist"
        render :new, status: :unprocessable_entity and return
      end
      amount = params[:amount].to_i
      if amount < 1
        flash[:notice] = "#{params[:amount]} is not a valid amount"
        render :new, status: :unprocessable_entity and return
      end
      amount = [ amount, 100 ].min
      amount.times do
        u.invitations.create!
      end
      redirect_to projects_path, notice: "Created #{amount} invitations for #{u.email}"
    elsif mode == "for_all"
      amount = params[:amount].to_i
      if amount < 1
        flash[:notice] = "#{params[:amount]} is not a valid amount"
        render :new, status: :unprocessable_entity and return
      end
      amount = [ amount, 5 ].min
      User.joins("INNER JOIN invitations ON users.id = invitations.recipient_user_id").find_each do |u|
        amount.times do
          u.invitations.create!
        end
      end
      redirect_to projects_path, notice: "Created #{amount} invitations for all users"
    end
  end

  def redeem
    inv = Invitation.find_by code: params[:code]
    unless inv.present?
      redirect_to projects_path, alert: "Invalid invitation code"
      return
    end
    if inv.recipient_user.present?
      redirect_to projects_path, alert: "Invitation code has already been redeemed"
      return
    end
    inv.update! recipient_user: @current_user
    redirect_to projects_path, notice: "Invitation code successfully redeemed!"
  end
end
