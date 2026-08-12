class BuildsController < ApplicationController
  load_and_authorize_resource :project
  # build_all is a collection action with no :id in the URL -- CanCan's default
  # member-vs-collection convention would otherwise try Build.find(nil) for it, the
  # same reason :create is already excluded.
  load_and_authorize_resource :build, through: :project, except: [ :create, :build_all ]

  before_action :set_target, only: :create

  # A build occupies a container on the build server for minutes at a time, so the cost
  # of this endpoint is real and does not scale with how careful the caller is. build_all
  # is one request no matter how many builds it starts, so it counts as a single hit here
  # against a lower limit. There is no separate cap on total builds requested: past the
  # author's own concurrent-build limit they queue (see Build#slot_available?,
  # User#max_concurrent_builds) rather than being refused.
  rate_limit to: 20, within: 1.hour, only: :create,
             with: -> { reject_build("You've queued a lot of builds recently. Please wait a few minutes and try again.") }
  rate_limit to: 5, within: 1.hour, only: :build_all,
             with: -> { reject_build("You've queued a lot of builds recently. Please wait a few minutes and try again.") }

  def show
  end

  def check_status
    result = BuildStatusChecker.new(@build).check!
    redirect_to project_target_path(@project, @build.target),
                (result.ok? ? :notice : :alert) => result.message
  end

  # Stops a build that is still in flight, on the build server as well as here. Offered
  # wherever a build reads as Building, because a wrong target or a runaway build
  # otherwise holds one of the author's limited concurrent-build slots (see
  # User#max_concurrent_builds) for the full BUILD_TIMEOUT.
  def cancel
    result = BuildCanceller.new(@build).cancel!
    redirect_to project_target_path(@project, @build.target),
                (result.ok? ? :notice : :alert) => result.message
  end

  def create
    @build = queue_or_start_build(@target)
    # The row *is* the progress indicator: swap it into its building (or queued) state
    # in place rather than navigating to a page whose only job is to say so.
    respond_to do |format|
      format.turbo_stream do
        @target.reload
        streams = [ turbo_stream.replace(
          ActionView::RecordIdentifier.dom_id(@target),
          partial: "targets/target", locals: { target: @target }
        ) ]

        # Rebuilding from the drawer has to redraw the drawer too, or it keeps showing
        # the old state and a Rebuild button for a build already running. Guarded on
        # the frame id for the same reason as targets#publish: the dashboard carries
        # an empty "drawer" frame, and an unguarded update would pop the drawer open
        # on anyone who rebuilt from a row.
        #
        # update, not replace: replace swaps the <turbo-frame> element itself, and with
        # it the src Turbo set when the drawer was opened -- which is the very thing
        # Target#broadcast_drawer asks the frame to reload. A drawer that started its
        # own build would then sit on "Building" for good, deaf to the broadcast that
        # says the build finished, while the row behind it updated normally.
        if turbo_frame_request_id == "drawer"
          streams << turbo_stream.update("drawer",
            partial: "targets/drawer", locals: { project: @project, target: @target })
        end

        render turbo_stream: streams
      end
      format.html do
        message = @build.pending? ? "Building #{@target.name}." :
                    "#{@target.name} is queued -- it will start once a build slot frees up."
        redirect_to project_path(@project), notice: message
      end
    end
  end

  # The dashboard's bulk action. Never rejects for being over the concurrency cap --
  # every candidate either starts now or joins the queue, in the same order
  # Target.bulk_build_candidates returns them, so an author seeing several never-built
  # rows above a "Build all" click can trust the top ones start first.
  def build_all
    candidates = Target.bulk_build_candidates(@project.targets.includes(:current_build, :latest_build).to_a)
    return reject_build("Everything is already built and up to date.") if candidates.empty?

    results = candidates.map { |target| queue_or_start_build(target) }
    started = results.count(&:pending?)
    waiting = results.size - started

    message = +"Started #{started} #{"build".pluralize(started)} now."
    message << " #{waiting} more #{waiting == 1 ? "is" : "are"} queued and will start as slots free up." if waiting.positive?

    redirect_to project_path(@project), notice: message
  end

  def destroy
    target = @build.target
    @build.destroy!
    redirect_to project_target_path(@project, target), notice: "Build deleted.", status: :see_other
  end

  private

    def set_target
      @target = @project.targets.find(params[:target_id])
      authorize! :read, @target
    end

    # Whether to start now or queue depends on Build.slot_available? at the moment this
    # particular target is claimed, not on a count taken once up front -- so a bulk
    # request fills exactly as many slots as actually exist, one real save at a time,
    # with no separate bookkeeping to keep in sync with the database.
    def queue_or_start_build(target)
      build = target.builds.new(project: @project,
                                 status: Build.slot_available?(current_user) ? :pending : :queued)
      authorize! :create, build
      build.start! if build.save && build.pending?
      build
    end

    # Turbo follows a redirect from a turbo_stream request as a full visit, so the flash
    # renders normally and there is no separate error-stream path to maintain.
    def reject_build(message)
      redirect_to project_path(@project), alert: message
    end
end
