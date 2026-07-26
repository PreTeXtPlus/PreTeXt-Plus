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
      redirect_to project_path(@project), notice: "Added the #{@target.display_label} output."
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

  def destroy
    @target.destroy!
    redirect_to project_path(@project),
                notice: "Removed the #{@target.display_label} output.", status: :see_other
  end

  private

    def target_params
      params.expect(target: [ :name, :label, :output_format ])
    end
end
