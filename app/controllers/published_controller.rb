# The public face of a built target: /o/:project_id/:target_name/...
#
# Resolves a target to the build it currently publishes and serves that build's files to
# anyone, signed in or not. Publishing points at Target#current_build, so a later failed
# build never takes a live site down, and unpublishing takes effect immediately.
class PublishedController < ApplicationController
  include ServesBuildFiles

  allow_unauthenticated_access
  after_action :allow_iframe

  def show
    @project = Project.find(params[:project_id])
    @target = @project.targets.find_by!(name: params[:target_name])

    # An owner may preview their own unpublished output at its public URL; to everyone
    # else an unpublished target does not exist. 404 rather than 403 so the response
    # does not confirm that the target is there.
    raise ActiveRecord::RecordNotFound unless @target.published? || can?(:manage, @target)

    build = @target.current_build
    raise ActiveRecord::RecordNotFound if build.nil?

    authorize! :read, build
    serve_build_file(build, params[:relative_path])
  end

  # Lands a visitor one level inside the target so the built page's relative links
  # resolve. See the routes file for why this is an explicit index.html rather than a
  # trailing slash.
  #
  # Found, not Moved Permanently: a browser that cached a 301 would keep following it
  # after the target was unpublished.
  def redirect_to_index
    redirect_to published_file_path(params[:project_id], params[:target_name], "index.html"),
                status: :found
  end
end
