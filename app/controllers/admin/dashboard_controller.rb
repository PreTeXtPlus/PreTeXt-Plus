class Admin::DashboardController < Admin::BaseController
  def show
    @metrics = [
      { label: "Users", value: User.count, detail: "Total accounts" },
      { label: "Admins", value: User.where(admin: true).count, detail: "Admin users" },
      { label: "Subscribed users", value: subscribed_users.count, detail: "Active or trialing subscription access" },
      { label: "Projects", value: Project.count, detail: "All user-owned projects" },
      { label: "Recent sign-ins", value: User.where("last_sign_in_at >= ?", 7.days.ago).count, detail: "Unique users who signed in within the last 7 days" },
      { label: "Unconfirmed emails", value: User.where(confirmed_at: nil).count, detail: "Accounts that have not confirmed their email" }
    ]

    @recent_users = User.where.not(last_sign_in_at: nil).order(last_sign_in_at: :desc).limit(5)
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
