class LibraryAssetsController < ApplicationController
  allow_unauthenticated_access only: :share_file
  load_and_authorize_resource
  skip_authorize_resource only: :share_file

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
  # Root-relative and recomputed per-request, so it works as both the editor's
  # live thumbnail `<img src>` and the `source` PreTeXt resolves for a live
  # preview build -- unlike baking in a signed storage URL directly, it never
  # goes stale, and it works before the owning project_asset is ever saved.
  def preview_file
    response.headers["Cache-Control"] = "no-store, private"
    redirect_to @library_asset.url, allow_other_host: true
  end

  # Same redirect, but public: this is the target baked into a project's
  # *saved* pretext_source, which renders on the public /share page -- so it
  # has to work for anyone, signed in or not, just like `share` itself.
  def share_file
    response.headers["Cache-Control"] = "no-store, private"
    redirect_to @library_asset.url, allow_other_host: true
  end

  private
    # Only allow a list of trusted parameters through.
    def library_asset_params
      params.expect(library_asset: [ :kind, :file, :content, :description, :short_description ])
    end
end
