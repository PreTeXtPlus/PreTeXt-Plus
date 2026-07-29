class TargetsController < ApplicationController
  load_and_authorize_resource :project
  load_and_authorize_resource :target, through: :project

  # The drawer: build history, the last log, and settings. A drawer rather than a page
  # because build history is a rabbit hole you want to back out of with Escape.
  #
  # An overlay needs something behind it, and plenty of things arrive here as a full-page
  # visit rather than through the dashboard's frame: the breadcrumb on a build log, the
  # redirect after checking or deleting a build, a bookmarked URL. Rendering the drawer
  # alone left those on a page whose entire body was the panel -- so closing it emptied
  # the document and only a reload brought anything back. Answering with the dashboard,
  # drawer already open, means close always lands on the project.
  def show
    render "projects/show" unless turbo_frame_request_id == "drawer"
  end

  def create
    if @target.save
      redirect_to project_path(@project), notice: "Added the #{@target.name} output."
    else
      redirect_to project_path(@project), alert: @target.errors.full_messages.to_sentence
    end
  end

  def update
    if @target.update(target_params)
      redirect_to project_path(@project), notice: "Saved."
    else
      redirect_to project_target_path(@project, @target), alert: @target.errors.full_messages.to_sentence
    end
  end

  # Publishing never triggers a build: it exposes the build the target already points
  # at, and is reversible immediately.
  def publish
    publishing = params[:published].to_s != "false"

    if publishing && @target.current_build.nil?
      return redirect_to project_path(@project),
                         alert: "Build #{@target.name} before publishing it."
    end

    @target.update!(published: publishing)
    @target.make_current_build_public! if publishing

    respond_to do |format|
      format.turbo_stream do
        streams = [ turbo_stream.replace(
          ActionView::RecordIdentifier.dom_id(@target),
          partial: "targets/target", locals: { target: @target }
        ) ]

        # Publishing from the drawer has to redraw the drawer as well: it is the surface
        # that shows the public URL, and it would otherwise keep offering "Publish" for
        # something already published.
        #
        # Guarded on the frame id rather than done unconditionally, because the dashboard
        # carries an empty "drawer" frame of its own -- an unguarded update would pop the
        # drawer open on anyone who published from a row.
        #
        # update rather than replace, so that the frame element -- and the src a build's
        # broadcast reloads -- survives; see the same call in builds#create.
        if turbo_frame_request_id == "drawer"
          streams << turbo_stream.update("drawer",
            partial: "targets/drawer", locals: { project: @project, target: @target })
        end

        render turbo_stream: streams
      end
      format.html do
        redirect_to project_path(@project),
                    notice: publishing ? "#{@target.name} is now public." : "#{@target.name} is no longer public."
      end
    end
  end

  # Rolls what readers see back one step, by destroying the newest successful build:
  # Build's after_destroy re-runs sync_from_builds!, which promotes the previous success
  # to current_build. Not a new mechanism -- deleting a build has always fallen back this
  # way -- just a button over the one step the retention window guarantees is there.
  # Exactly one step deep, deliberately: deeper history is precisely what prune_builds!
  # no longer keeps, and an author who wants an older state rebuilds from source.
  def revert
    previous = @target.previous_successful_build
    if previous.nil?
      return redirect_to project_target_path(@project, @target),
                         alert: "There is no earlier build to go back to."
    end

    @target.current_build.destroy!
    redirect_to project_target_path(@project, @target),
                notice: "Restored the build from #{previous.created_at.to_fs(:long)}.",
                status: :see_other
  end

  def destroy
    @target.destroy!
    redirect_to project_path(@project),
                notice: "Removed the #{@target.name} output.", status: :see_other
  end

  private

    def target_params
      params.expect(target: [ :name, :kind ])
    end
end
