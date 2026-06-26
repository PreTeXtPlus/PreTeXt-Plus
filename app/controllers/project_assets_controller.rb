class ProjectAssetsController < ApplicationController
  # The editor owns its live asset pool and has already updated its UI
  # optimistically before these fire; our only job is to persist the project's
  # membership of a library asset immediately (the asset analogue of
  # DivisionsController#create), so a later onLoadAssets / project refetch sees
  # it as server truth. The library asset itself is created separately via
  # LibraryAssetsController.

  # POST /projects/:project_id/project_assets
  def create
    @project = Project.accessible_by(current_ability).find(params[:project_id])
    @project_asset = @project.project_assets.build(project_asset_params)
    authorize! :create, @project_asset

    respond_to do |format|
      if @project_asset.save
        format.json { render "project_assets/show", status: :created }
      else
        format.json { render json: @project_asset.errors, status: :unprocessable_entity }
      end
    end
  end

  # DELETE /projects/:project_id/project_assets/:id
  #
  # `:id` is the *library_asset* id, not the join-row PK: the editor identifies
  # an asset by its library asset (its `Asset.id`) and never sees the join id,
  # and a project has at most one membership per library asset (ProjectAsset
  # enforces uniqueness), so resolving by library_asset_id is unambiguous and
  # needs no client-side bookkeeping. Only the membership row is removed; the
  # library asset persists.
  def destroy
    @project = Project.accessible_by(current_ability).find(params[:project_id])
    @project_asset = @project.project_assets.find_by!(library_asset_id: params[:id])
    authorize! :destroy, @project_asset
    @project_asset.destroy!

    respond_to do |format|
      format.json { head :no_content }
    end
  end

  private
    # Only allow a list of trusted parameters through. `ref` is the editor's
    # client-generated reference; uniqueness (among assets and divisions) is
    # enforced by the model to guard against a race between two clients.
    def project_asset_params
      params.expect(project_asset: [ :ref, :library_asset_id ])
    end
end
