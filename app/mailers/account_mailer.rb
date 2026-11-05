class AccountMailer < ApplicationMailer
  # To a user who has just deleted their account: confirms it, says when it becomes
  # permanent, and how to undo it before then.
  def deletion_requested(user)
    @user = user

    mail(
      to: user.email,
      subject: "Your PreTeXt.Plus account has been deleted"
    )
  end
end
