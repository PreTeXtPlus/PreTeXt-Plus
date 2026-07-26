# The public face of a built target: /o/:project_id/:target_name/...
#
# Resolves a target to the build it currently publishes and serves that build's files to
# anyone, signed in or not. Publishing points at Target#current_build, so a later failed
# build never takes a live site down, and unpublishing takes effect immediately.
class PublishedController < ApplicationController
  include ServesBuildFiles

  allow_unauthenticated_access
  after_action :allow_iframe

  before_action :load_published_build

  def show
    serve_build_file(@build, params[:relative_path])
  end

  # Lands a visitor on the target's entry point -- index.html for a site, the artifact
  # itself for a pdf or braille build. For a site this also puts them one level inside
  # the target so the built page's relative links resolve; see the routes file for why
  # that is an explicit filename rather than a trailing slash.
  #
  # Found, not Moved Permanently: a browser that cached a 301 would keep following it
  # after the target was unpublished.
  def redirect_to_index
    entry = @target.entry_path
    raise ActiveRecord::RecordNotFound if entry.blank?

    redirect_to published_file_path(@project, @target.name, entry), status: :found
  end

  private

    def load_published_build
      @project = Project.find(params[:project_id])
      @target = @project.targets.find_by!(name: params[:target_name])

      # An owner may preview their own unpublished output at its public URL; to everyone
      # else an unpublished target does not exist. 404 rather than 403 so the response
      # does not confirm that the target is there.
      raise ActiveRecord::RecordNotFound unless @target.published? || can?(:manage, @target)

      @build = @target.current_build
      raise ActiveRecord::RecordNotFound if @build.nil?

      authorize! :read, @build
    end
end
