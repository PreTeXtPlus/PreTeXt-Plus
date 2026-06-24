class Admin::AnnouncementsController < Admin::BaseController
  before_action :set_announcement, only: %i[show edit update destroy publish]

  def index
    @announcements = Announcement.order(created_at: :desc)
  end

  def show
  end

  def new
    @announcement = Announcement.new
  end

  def create
    @announcement = Announcement.new(announcement_params)
    if @announcement.save
      redirect_to admin_announcement_path(@announcement), notice: "Announcement created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @announcement.update(announcement_params)
      redirect_to admin_announcement_path(@announcement), notice: "Announcement updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @announcement.destroy
    redirect_to admin_announcements_path, notice: "Announcement deleted."
  end

  def publish
    if @announcement.published?
      redirect_to admin_announcement_path(@announcement), alert: "This announcement has already been published."
    else
      @announcement.publish!
      redirect_to admin_announcement_path(@announcement),
        notice: "Announcement published and email broadcast queued for all subscribed users."
    end
  end

  private

  def set_announcement
    @announcement = Announcement.find(params[:id])
  end

  def announcement_params
    params.require(:announcement).permit(:title, :body)
  end
end
