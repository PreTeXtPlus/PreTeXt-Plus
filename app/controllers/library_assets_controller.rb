class LibraryAssetsController < ApplicationController
  load_and_authorize_resource

  def index
    @library_assets = LibraryAsset.where user: current_user
  end

  def show
  end

  def create
    @library_asset.user = current_user

    respond_to do |format|
      if @library_asset.save
        format.json { render :show, status: :created, location: @library_asset }
      else
        format.json { render json: @library_asset.errors, status: :unprocessable_entity }
      end
    end
  end

  def update
    respond_to do |format|
      if @library_asset.update(library_asset_params)
        format.json { render :show, status: :ok, location: @library_asset }
      else
        format.json { render json: @library_asset.errors, status: :unprocessable_entity }
      end
    end
  end

  def destroy
    @library_asset.destroy!

    respond_to do |format|
      format.json { head :no_content }
    end
  end

  # Redirects to the asset's current file URL, generated fresh on every hit.
  # Owner-only, and id-scoped rather than ref-scoped: this only backs the Asset
  # Manager's thumbnail `<img src>` when browsing the full cross-project
  # library, where an asset may not belong to any project yet (and so has no
  # project-scoped ref). Live preview/share builds resolve their `<image
  # source>` references through ProjectAssetsController#preview_file /
  # #share_file instead, since those are ref + project scoped.
  def file
    redirect_to_cdn_url @library_asset.url
  end

  private
    # Only allow a list of trusted parameters through.
    def library_asset_params
      params.expect(library_asset: [ :kind, :file, :content, :description, :short_description ])
    end
end
