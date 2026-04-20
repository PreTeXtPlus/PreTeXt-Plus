class Admin::ProjectsController < Admin::BaseController
  def show
    @project = Project.includes(:user).find(params[:id])
  end
end
