class Admin::ProjectsController < Admin::BaseController
  def show
    @project = Project.includes(:user).find(params[:id])
  end

  # Flag/unflag a project as a template offered on the new-project page, and
  # edit the short description shown alongside it in the template picker.
  def update
    @project = Project.find(params[:id])
    if @project.update(template_params)
      redirect_to admin_project_path(@project), notice: "Template settings saved."
    else
      redirect_to admin_project_path(@project), alert: @project.errors.full_messages.to_sentence
    end
  end

  private

  def template_params
    params.expect(project: [ :is_template, :template_description ])
  end
end
