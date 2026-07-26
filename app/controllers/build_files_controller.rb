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
    serve_build_file(@build, params[:relative_path])
  end

  private

    def load_and_authorize_build
      @build = Build.find(params[:build_id])
      authorize! :read, @build
    end
end
