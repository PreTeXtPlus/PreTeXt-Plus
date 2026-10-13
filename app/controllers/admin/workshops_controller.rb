class Admin::WorkshopsController < Admin::BaseController
  load_and_authorize_resource

  def index
    @workshops = Workshop.order(start_time: :desc)
  end

  def new
  end

  def create
    if @workshop.save
      redirect_to admin_workshops_path, notice: "Workshop created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @workshop.update(workshop_params)
      redirect_to admin_workshops_path, notice: "Workshop updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @workshop.destroy
    redirect_to admin_workshops_path, notice: "Workshop deleted."
  end

  private

  def workshop_params
    params.require(:workshop).permit(:title, :start_time, :link)
  end
end
