class AssetsController < ApplicationController
  allow_unauthenticated_access only: %i[ share share_thumbnail ]

  # GET /projects/:id/(*)/external/:ref
  #
  # Public: used both by the editor's own full-size asset previews and by
  # published/shared builds' <image source> resolution. Every Asset always
  # has a project_id + ref now, so this single project+ref-scoped lookup
  # covers every live use.
  def share
    @project = Project.find(params[:id])
    begin
      @asset = @project.assets.find_by!(ref: params[:ref])
    rescue ActiveRecord::RecordNotFound => e
      # If the ref is "icon", it's a special case: PreTeXtPlus's own built-in logo,
      # referenced by default docinfo as `icon.*` Previously used `.svg` but we now
      # always point to the png.
      if params[:ref] == "icon"
        return redirect_to "/icon-small.png"
      end
      raise e
    end
    redirect_to_cdn_url @asset.url
  end

  # GET /projects/:id/(*)/external/:ref/thumbnail
  #
  # Same scoping as `share`, but redirects to a small resized preview instead
  # of the full file -- used by the editor's asset manager list and the
  # project dashboard's asset list. 404s when there's nothing to preview (no
  # file, or a file type ActiveStorage can't raster a variant of); callers
  # fall back to a generic file icon in that case.
  def share_thumbnail
    @project = Project.find(params[:id])
    @asset = @project.assets.find_by!(ref: params[:ref])
    url = @asset.thumbnail_url
    return head :not_found unless url

    redirect_to_cdn_url url
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
