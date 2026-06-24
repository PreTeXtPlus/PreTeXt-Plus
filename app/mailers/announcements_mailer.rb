class AnnouncementsMailer < ApplicationMailer
  default from: "announcements@mailer.pretext.plus"

  def announcement(user, announcement)
    @user = user
    @announcement = announcement
    @unsubscribe_url = unsubscribe_announcements_url(token: user.announcement_unsubscribe_token)

    headers["X-PM-Message-Stream"] = "broadcast"

    mail(
      to: user.email,
      subject: announcement.title
    )
  end
end
