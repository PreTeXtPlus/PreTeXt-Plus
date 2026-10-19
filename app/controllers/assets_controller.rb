class AssetsController < ApplicationController
  allow_unauthenticated_access only: %i[ share share_thumbnail generated_file ]

  # GET /projects/:id/(*)/external/:ref
  #
  # Public: used both by the editor's own full-size asset previews and by
  # published/shared builds' <image source> resolution. Every Asset always
  # has a project_id + ref now, so this single project+ref-scoped lookup
  # covers every live use.
  def share
    @project = Project.find(params[:id])
    @asset = @project.assets.find_by!(ref: params[:ref])
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

  # GET /projects/:id/(*)/generated/:generator/:filename
  #
  # One file of a generated asset's output set, looked up by the name a build would
  # give it (see Asset#generated_files). The ref is a prefix of the filename, so the
  # candidates are the project's generated assets whose ref the name starts with --
  # a ref may itself contain "-", which is why the name is not split on it.
  def generated_file
    @project = Project.find(params[:id])
    filename = params[:filename].to_s
    asset = @project.assets.generated_kind.where(generator: params[:generator]).detect do |candidate|
      filename.start_with?("#{candidate.ref}.", "#{candidate.ref}-")
    end
    blob = asset&.generated_files&.fetch(filename, nil)
    return head :not_found unless blob

    # Through the service rather than Blob#url for the same reason as Asset#url: an SVG
    # is forced to `attachment` by Blob#url, and these are fetched by a renderer, not saved.
    redirect_to_cdn_url blob.service.url(blob.key, expires_in: 1.hour, filename: ActiveStorage::Filename.new(filename),
                                         content_type: blob.content_type, disposition: :inline)
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
