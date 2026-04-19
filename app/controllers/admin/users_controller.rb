class Admin::UsersController < Admin::BaseController
  before_action :set_user, only: :show

  def index
    @filters = filter_params.to_h
    @requested_user_lookup = Request.distinct.pluck(:user_id).index_with(true)
    @invited_user_lookup = Invitation.where.not(recipient_user_id: nil).distinct.pluck(:recipient_user_id).index_with(true)

    @users = filtered_users.includes(subscription_seats: :subscription)
  end

  def show
    @requested_user_lookup = Request.where(user: @user).distinct.pluck(:user_id).index_with(true)
    @invited_user_lookup = Invitation.where(recipient_user: @user).distinct.pluck(:recipient_user_id).index_with(true)
    @recent_sessions = @user.sessions.order(created_at: :desc).limit(10)
    @projects = @user.projects.order(updated_at: :desc)
    @subscription_seats = @user.subscription_seats.includes(:subscription)
    @requests = Request.where(user: @user).order(created_at: :desc)
    @received_invitations = Invitation.where(recipient_user: @user).order(created_at: :desc)
    @owned_invitations = Invitation.where(owner_user: @user).order(created_at: :desc)
  end

  private

  def set_user
    @user = User.includes(subscription_seats: :subscription).find(params[:id])
  end

  def filtered_users
    scope = User.select(
      "users.*",
      "(SELECT COUNT(*) FROM projects WHERE projects.user_id = users.id) AS projects_count",
      "(SELECT MAX(sessions.created_at) FROM sessions WHERE sessions.user_id = users.id) AS last_session_at"
    )

    if filter_params[:q].present?
      query = "%#{ActiveRecord::Base.sanitize_sql_like(filter_params[:q].strip.downcase)}%"
      scope = scope.where(
        "LOWER(users.email) LIKE :query OR LOWER(COALESCE(users.name, '')) LIKE :query",
        query: query
      )
    end

    scope = scope.where(admin: true) if filter_params[:admin] == "1"
    scope = scope.where(id: subscribed_user_ids) if filter_params[:subscribed] == "1"
    scope = scope.where(id: Request.select(:user_id)) if filter_params[:requested] == "1"
    scope = scope.where(id: Invitation.where.not(recipient_user_id: nil).select(:recipient_user_id)) if filter_params[:invited] == "1"

    scope.order(Arel.sql("last_session_at DESC NULLS LAST, users.created_at DESC"))
  end

  def subscribed_user_ids
    User.joins(subscription_seats: :subscription)
      .where(pay_subscriptions: { status: %w[active trialing] })
      .distinct
      .select(:id)
  end

  def filter_params
    params.permit(:q, :admin, :subscribed, :requested, :invited)
  end
end
