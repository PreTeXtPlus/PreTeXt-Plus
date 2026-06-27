# Preview all emails at /rails/mailers/announcements_mailer
class AnnouncementsMailerPreview < ActionMailer::Preview
  # Preview this email at /rails/mailers/announcements_mailer/announcement
  def announcement
    announcement = Announcement.new(
      title: "Title",
      body: "# Body Text\n\nHello."
    )
    AnnouncementsMailer.announcement(User.take, announcement)
  end
end
