# Owner-facing access to a build's output, addressed by build id. Used by "View" on the
# dashboard, which can reach any of a project's builds -- including superseded ones, so
# an author can check what an older build actually produced. The public route into the
# same files is PublishedController.
class BuildFilesController < ApplicationController
  include ServesBuildFiles

  # Deliberately still login-only. Published output has its own public route; keeping
  # exactly one anonymous surface means unpublishing cannot be worked around by
  # addressing the build directly.
  before_action :load_and_authorize_build

  def show
    serve_build_file(@build, params[:relative_path], disposition: requested_disposition)
  end

  # A site's "Download" is the whole output directory, zipped, rather than a single
  # build file -- see #show for that case. Its own action (rather than reusing #show)
  # since the zip is attached directly to the build, not stored as a BuildFile.
  def zip
    raise ActiveRecord::RecordNotFound unless @build.zip.attached?

    redirect_to_cdn_url @build.zip.url(disposition: "attachment")
  end

  private

    # Only "attachment" is honoured, and only as an exact match: anything else falls back
    # to how the file is normally served, so the parameter can never be used to change
    # the content type or disposition of a response into something unexpected.
    def requested_disposition
      params[:disposition] == "attachment" ? "attachment" : "inline"
    end

    def load_and_authorize_build
      @build = Build.find(params[:build_id])
      authorize! :read, @build
    end
end
