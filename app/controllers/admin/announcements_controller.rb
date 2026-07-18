class Admin::AnnouncementsController < Admin::BaseController
  load_and_authorize_resource

  def index
    @announcements = Announcement.order(created_at: :desc)
  end

  def show
  end

  def new
  end

  def create
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
    elsif @announcement.draft?
      redirect_to admin_announcement_path(@announcement),
        alert: "This announcement is still a draft. Save it as Ready to Publish before publishing."
    else
      @announcement.publish!
      audience = @announcement.paid_subscribers_only? ? "paid subscribers" : "all subscribed users"
      redirect_to admin_announcement_path(@announcement),
        notice: "Announcement published and email broadcast queued for #{audience}."
    end
  end

  private

  def announcement_params
    params.require(:announcement).permit(:title, :body, :paid_subscribers_only, :draft)
  end
end
