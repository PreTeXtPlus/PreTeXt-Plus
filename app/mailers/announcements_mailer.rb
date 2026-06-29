class AnnouncementsMailer < ApplicationMailer
  default from: "announcements@mailer.pretext.plus"
  default reply_to: "support@pretext.plus"

  def announcement(user, announcement)
    @user = user
    @announcement = announcement

    mail(
      to: user.email,
      subject: announcement.title,
      message_stream: "broadcast"
    )
  end
end
