class Admin::MaintenanceWindowsController < Admin::BaseController
  load_and_authorize_resource

  def index
    @maintenance_windows = MaintenanceWindow.order(starts_at: :desc)
  end

  def new
  end

  def create
    if @maintenance_window.save
      redirect_to admin_maintenance_windows_path, notice: "Maintenance window scheduled."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @maintenance_window.update(maintenance_window_params)
      redirect_to admin_maintenance_windows_path, notice: "Maintenance window updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @maintenance_window.destroy
    redirect_to admin_maintenance_windows_path, notice: "Maintenance window deleted."
  end

  private

  def maintenance_window_params
    params.require(:maintenance_window).permit(:starts_at, :note)
  end
end
