class RequestsController < ApplicationController
  # POST /requests or /requests.json
  def create
    @request = Request.new(user: current_user)

    respond_to do |format|
      if @request.save
        format.html { redirect_to projects_path, notice: "Invitation has been successfully requested." }
        format.json { render :show, status: :created, location: @request }
      else
        format.html { render :new, status: :unprocessable_entity }
        format.json { render json: @request.errors, status: :unprocessable_entity }
      end
    end
  end
end
