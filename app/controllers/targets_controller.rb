class TargetsController < ApplicationController
  load_and_authorize_resource :project
  load_and_authorize_resource :target, through: :project

  # The drawer: build history, the last log, and settings. A drawer rather than a page
  # because build history is a rabbit hole you want to back out of with Escape.
  def show
    @builds = @target.builds.order(created_at: :desc).limit(20)
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
        # carries an empty "drawer" frame of its own -- an unguarded replace would pop the
        # drawer open on anyone who published from a row.
        if turbo_frame_request_id == "drawer"
          @builds = @target.builds.order(created_at: :desc).limit(20)
          streams << turbo_stream.replace("drawer", template: "targets/show")
        end

        render turbo_stream: streams
      end
      format.html do
        redirect_to project_path(@project),
                    notice: publishing ? "#{@target.name} is now public." : "#{@target.name} is no longer public."
      end
    end
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
