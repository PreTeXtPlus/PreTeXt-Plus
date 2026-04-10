class DashboardsController < ApplicationController
  before_action :require_admin_user

  def index
    @total_users = User.count
    @invited_users = User.joins(:invitations).where(invitations: { recipient_user_id: nil }).distinct.count
    @beta_users = User.where(subscription: :beta).count
    @sustaining_users = User.where(subscription: :sustaining).count
    @total_projects = Project.count
    @projects_by_format = Project.group(:source_format).count
    @projects_by_user = User.select('users.id, users.email, COUNT(projects.id) as project_count')
                              .joins(:projects)
                              .group('users.id')
                              .order('project_count DESC')
                              .limit(10)
  end

  private

  def require_admin_user
    redirect_to root_path, alert: 'Access denied' unless Current.user&.admin?
  end
end
