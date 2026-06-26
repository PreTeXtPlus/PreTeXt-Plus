class DivisionsController < ApplicationController
  # The editor has already built the division locally and added it to its own
  # pool before this fires, so all we do is persist it and hand back the real
  # primary key the client-side placeholder id gets replaced with.
  def create
    @project = Project.accessible_by(current_ability).find(params[:project_id])
    @division = @project.divisions.build(division_params)
    authorize! :create, @division

    respond_to do |format|
      if @division.save
        format.json { render json: { id: @division.id }, status: :created }
      else
        format.json { render json: @division.errors, status: :unprocessable_entity }
      end
    end
  end

  private
    # Only allow a list of trusted parameters through. `ref` is the editor's
    # client-generated xml:id, stored as given (uniqueness is still enforced by
    # the model validation to guard against a race between two clients).
    def division_params
      params.expect(division: [ :ref, :source_format, :source ])
    end
end
