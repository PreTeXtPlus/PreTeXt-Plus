class Admin::UsersController < Admin::BaseController
  before_action :set_user, only: %i[show confirm reset_password]

  def index
    @filters = filter_params.to_h

    @users = filtered_users.includes(subscription_seats: :subscription)
  end

  def show
    @projects = @user.projects.order(updated_at: :desc)
    @subscription_seats = @user.subscription_seats.includes(:subscription)
  end

  def confirm
    @user.confirm
    redirect_to admin_user_path(@user), notice: "Confirmed #{@user.email}."
  end

  def reset_password
    @user.send_reset_password_instructions
    redirect_to admin_user_path(@user), notice: "Sent password reset email to #{@user.email}."
  end

  private

  def set_user
    @user = User.includes(subscription_seats: :subscription).find(params[:id])
  end

  def filtered_users
    scope = User.select(
      "users.*",
      "(SELECT COUNT(*) FROM projects WHERE projects.user_id = users.id) AS projects_count"
    )

    if filter_params[:q].present?
      query = "%#{ActiveRecord::Base.sanitize_sql_like(filter_params[:q].strip.downcase)}%"
      scope = scope.where(
        "LOWER(users.email) LIKE :query OR LOWER(COALESCE(users.name, '')) LIKE :query",
        query: query
      )
    end

    scope = scope.where(admin: true) if filter_params[:admins_only] == "1"
    scope = scope.where(id: subscribed_user_ids) if filter_params[:subscribed] == "1"
    scope = scope.where(confirmed_at: nil) if filter_params[:unconfirmed] == "1"

    scope.order(Arel.sql("users.last_sign_in_at DESC NULLS LAST, users.created_at DESC"))
  end

  def subscribed_user_ids
    User.joins(subscription_seats: :subscription)
      .where(pay_subscriptions: { status: %w[active trialing] })
      .distinct
      .select(:id)
  end

  def filter_params
    params.permit(:q, :admins_only, :subscribed, :unconfirmed)
  end
end
