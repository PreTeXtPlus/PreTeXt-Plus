class BuildsController < ApplicationController
  load_and_authorize_resource :project
  load_and_authorize_resource :build, through: :project

  def index
  end

  def show
  end

  def check_status
    result = BuildStatusChecker.new(@build).check!
    if result.ok?
      redirect_to project_build_path(@project, @build), notice: result.message
    else
      redirect_to project_build_path(@project, @build), alert: result.message
    end
  end

  def create
    # A build now belongs to a target. Until the dashboard lets you pick one (PR 2),
    # fall back to the project's first -- which for every existing project is `web`.
    @build.target ||= @project.targets.first

    if @build.save
      FullBuildJob.perform_later(@build)
      redirect_to project_build_path(@project, @build), notice: "Build was successfully created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def destroy
    @build.destroy!
    redirect_to project_builds_path(@project), notice: "Build was successfully deleted.", status: :see_other
  end

  private

    def build_params
      params.permit(build: [ :status ]).fetch(:build, {})
    end
end
