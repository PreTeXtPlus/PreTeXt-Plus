class CollaborationMailer < ApplicationMailer
  # To an invitee with no (confirmed) account yet: invites them to sign up;
  # the collaboration is claimed automatically once they confirm that email.
  def invitation(collaboration)
    @collaboration = collaboration
    @project = collaboration.project
    @owner = @project.user

    mail(
      to: collaboration.invited_email,
      subject: "#{@owner.name_with_email} invited you to collaborate on PreTeXt.Plus"
    )
  end

  # To an existing user who has just been added as a collaborator.
  def added(collaboration)
    @collaboration = collaboration
    @project = collaboration.project
    @owner = @project.user

    mail(
      to: collaboration.invited_email,
      subject: "You can now edit \"#{@project.title}\" on PreTeXt.Plus"
    )
  end
end
