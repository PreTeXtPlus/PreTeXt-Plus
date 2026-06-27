class AnnouncementsMailer < ApplicationMailer
  default from: "announcements@mailer.pretext.plus"
  default reply_to: "support@pretext.plus"

  def announcement(user, announcement)
    @user = user
    @announcement = announcement
    @unsubscribe_url = unsubscribe_announcements_url(token: user.announcement_unsubscribe_token)

    mail(
      to: user.email,
      subject: announcement.title,
      message_stream: "broadcast"
    )
  end
end
