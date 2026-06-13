class ProjectAssetsController < ApplicationController
  load_and_authorize_resource :project_asset, through: :project

  def index
    @project_assets = @project.project_assets.joins(:library_asset)
  end


  def show
  end


  def create
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
    # Only allow a list of trusted parameters through.
    def project_asset_params
      params.expect(project_asset: [ :library_asset_id ])
    end
end
