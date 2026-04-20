class Admin::DashboardController < Admin::BaseController
  def show
    @metrics = [
      { label: "Users", value: User.count, detail: "Total accounts" },
      { label: "Admins", value: User.where(admin: true).count, detail: "Admin users" },
      { label: "Subscribed users", value: subscribed_users.count, detail: "Active or trialing subscription access" },
      { label: "Projects", value: Project.count, detail: "All user-owned projects" },
      { label: "Recent sign-ins", value: Session.where("created_at >= ?", 7.days.ago).distinct.count(:user_id), detail: "Unique users in the last 7 days" },
      { label: "Access requests", value: Request.count, detail: "Outstanding invitation requests" },
      { label: "Claimed invitations", value: Invitation.where.not(recipient_user_id: nil).distinct.count(:recipient_user_id), detail: "Users with invitation records" },
      { label: "Open invitation codes", value: Invitation.where(recipient_user_id: nil).count, detail: "Invite codes not yet claimed" }
    ]

    @recent_sessions = Session.includes(:user).order(created_at: :desc).limit(5)
    @recent_projects = Project.includes(:user).order(updated_at: :desc).limit(5)
    @host_health = Admin::HostHealth.snapshot
  end

  private

  def subscribed_users
    User.joins(subscription_seats: :subscription)
      .where(pay_subscriptions: { status: %w[active trialing] })
      .distinct
  end
end
