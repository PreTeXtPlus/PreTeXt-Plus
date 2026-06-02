class ProjectAssetsController < ApplicationController
  before_action :set_project_asset, only: %i[ show edit update destroy ]
  before_action :set_project
  before_action :authorize_user

  def index
    @project_assets = @project.project_assets
  end


  def show
  end


  def new
    @project_asset = ProjectAsset.new
  end


  def edit
  end


  def create
    @project_asset = ProjectAsset.new(project_asset_params)
    @project_asset.project = @project

    respond_to do |format|
      if @project_asset.save
        format.html { redirect_to project_asset_path(@project_asset.project, @project_asset), notice: "Project asset was successfully created." }
        format.json { render :show, status: :created, location: @project_asset }
      else
        format.html { render :new, status: :unprocessable_entity }
        format.json { render json: @project_asset.errors, status: :unprocessable_entity }
      end
    end
  end


  def update
    respond_to do |format|
      if @project_asset.update(project_asset_params)
        format.html { redirect_to project_asset_path(@project_asset.project, @project_asset), notice: "Project asset was successfully updated.", status: :see_other }
        format.json { render :show, status: :ok, location: @project_asset }
      else
        format.html { render :edit, status: :unprocessable_entity }
        format.json { render json: @project_asset.errors, status: :unprocessable_entity }
      end
    end
  end


  def destroy
    @project_asset.destroy!

    respond_to do |format|
      format.html { redirect_to project_assets_path(@project), notice: "Project asset was successfully destroyed.", status: :see_other }
      format.json { head :no_content }
    end
  end

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_project_asset
      @project_asset = ProjectAsset.find(params.expect(:id))
    end

    def set_project
      if @project_asset.present?
        return @project = @project_asset.project
      end
      @project = Project.find(params.expect(:project_id))
    end

    # Only allow a list of trusted parameters through.
    def project_asset_params
      params.expect(project_asset: [ :library_asset_id ])
    end

    def authorize_user
      if @project.user != @current_user
        redirect_to projects_path, alert: "Not authorized"
      end
    end
end
