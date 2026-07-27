class BuildsController < ApplicationController
  load_and_authorize_resource :project
  load_and_authorize_resource :build, through: :project, except: :create

  before_action :set_target, only: :create

  # A build occupies a container on the build server for minutes at a time, so the cost
  # of this endpoint is real and does not scale with how careful the caller is. Two
  # independent bounds: a burst limit here, and a cap on how many builds one user may
  # have running at once (see #within_concurrency_cap?).
  rate_limit to: 20, within: 1.hour, only: :create,
             with: -> { reject_build("You've started a lot of builds recently. Please wait a few minutes and try again.") }

  MAX_CONCURRENT_BUILDS = 3

  def show
  end

  def check_status
    result = BuildStatusChecker.new(@build).check!
    redirect_to project_target_path(@project, @build.target),
                (result.ok? ? :notice : :alert) => result.message
  end

  # Stops a build that is still in flight, on the build server as well as here. Offered
  # wherever a build reads as Building, because a wrong target or a runaway build
  # otherwise holds one of the author's MAX_CONCURRENT_BUILDS slots for the full
  # BUILD_TIMEOUT.
  def cancel
    result = BuildCanceller.new(@build).cancel!
    redirect_to project_target_path(@project, @build.target),
                (result.ok? ? :notice : :alert) => result.message
  end

  def create
    return reject_build("You already have #{MAX_CONCURRENT_BUILDS} builds running. Wait for one to finish.") unless within_concurrency_cap?

    # project is set explicitly rather than left to Build's before_validation, because
    # cancancan authorizes against build.project and `new` does not run validations.
    @build = @target.builds.new(project: @project)
    authorize! :create, @build

    if @build.save
      FullBuildJob.perform_later(@build)
      # The row *is* the progress indicator: swap it into its building state in place
      # rather than navigating to a page whose only job is to say "queued".
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
        format.html { redirect_to project_path(@project), notice: "Building #{@target.name}." }
      end
    else
      reject_build(@build.errors.full_messages.to_sentence)
    end
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

    def within_concurrency_cap?
      Build.where(project_id: current_user.project_ids,
                  status: Build.statuses.values_at(*Target::IN_FLIGHT)).count < MAX_CONCURRENT_BUILDS
    end

    # Turbo follows a redirect from a turbo_stream request as a full visit, so the flash
    # renders normally and there is no separate error-stream path to maintain.
    def reject_build(message)
      redirect_to project_path(@project), alert: message
    end
end
