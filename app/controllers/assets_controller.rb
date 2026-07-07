class AssetsController < ApplicationController
  allow_unauthenticated_access only: :share

  # GET /projects/:id/(*)/external/:ref
  #
  # Public: used both by the editor's own preview/thumbnails and by
  # published/shared builds' <image source> resolution. Every Asset always
  # has a project_id + ref now, so this single project+ref-scoped lookup
  # covers every live use.
  def share
    @project = Project.find(params[:id])
    @asset = @project.assets.find_by!(ref: params[:ref])
    redirect_to_cdn_url @asset.url
  end

  # GET /share_assets/external/:id
  #
  # Deprecated legacy link (used by old builds to serve up assets), kept
  # working. Owner-only, id-scoped -- see `share` above for the current,
  # project+ref-scoped mechanism used everywhere else.
  def file
    @asset = Asset.find(params[:id])
    authorize! :read, @asset
    redirect_to_cdn_url @asset.url
  end
end
