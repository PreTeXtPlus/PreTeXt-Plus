class BuildsController < ApplicationController
  load_and_authorize_resource :project
  load_and_authorize_resource :build, through: :project

  def index
  end

  def show
  end

  def create
    if @build.save
      FetchBuildZipJob.perform_later(@build)
      redirect_to project_build_path(@project, @build), notice: "Build was successfully created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

    def build_params
      params.permit(build: [ :status ]).fetch(:build, {})
    end
end
