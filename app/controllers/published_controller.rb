# The public face of a built target: /o/:project_id/:target_slug/...
#
# Resolves a target to the build it currently publishes and serves that build's files to
# anyone, signed in or not. Publishing points at Target#current_build, so a later failed
# build never takes a live site down, and unpublishing takes effect immediately.
#
# In production these routes answer only on the published origin (pub.pretext.plus),
# and nothing else answers there: the output is user-authored HTML and JavaScript, so
# it must not run on the origin that holds sessions. See config/routes.rb and
# docs/build-targets.md.
class PublishedController < ApplicationController
  include ServesBuildFiles

  allow_unauthenticated_access
  after_action :allow_iframe

  # Everything here is addressed by a link someone was handed, so every way of missing --
  # unpublished, never built, wrong target slug, a page that is not in the build -- ends at
  # the same explanation rather than at a Rails error page or a bounce to the login form.
  # AccessDenied is included for the same reason: on a public URL, 403 is never the answer
  # we want to give (see load_published_build).
  rescue_from ActiveRecord::RecordNotFound, CanCan::AccessDenied, with: :render_not_found

  before_action :load_published_build

  def show
    serve_build_file(@build, params[:relative_path], public: !@target.site?)
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

    redirect_to published_file_path(@project, @target.slug, entry), status: :found
  end

  private

    # Only a navigation gets the page. A published site requesting an image or stylesheet
    # that is not in the build asks for those too, and answering a missing sprite with a
    # rendered HTML page is wasted work the browser throws away.
    def render_not_found
      return head :not_found unless request.format.html?

      render "not_found", status: :not_found
    end

    def load_published_build
      @project = Project.find(params[:project_id])
      @target = @project.targets.find_by!(slug: params[:target_slug])

      # An unpublished target does not exist here, for everyone -- owner included. The
      # session cookie is host-only on the app origin, so on the published origin every
      # visitor is anonymous and an owner exception could never actually fire; owners
      # preview through the dashboard's Preview button (build_file_path) instead. 404
      # rather than 403 so the response does not confirm the target is there.
      raise ActiveRecord::RecordNotFound unless @target.published?

      @build = @target.current_build
      raise ActiveRecord::RecordNotFound if @build.nil?

      authorize! :read, @build
    end
end
