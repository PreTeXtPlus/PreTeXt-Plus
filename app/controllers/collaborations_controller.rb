class CollaborationsController < ApplicationController
  before_action :set_project

  # POST /projects/:project_id/collaborations
  # Invite by email. A confirmed account under that email becomes a
  # collaborator immediately; otherwise the row sits pending until someone
  # confirms an account with that address (Collaboration.claim_for).
  def create
    collaboration = @project.collaborations.build(invited_email: params[:email])
    authorize! :create, collaboration

    # An unconfirmed account is treated like no account: the invite stays
    # pending and gets claimed automatically when the email is confirmed.
    invitee = User.find_by(email: collaboration.invited_email)
    invitee = nil unless invitee&.confirmed?
    if invitee
      collaboration.user = invitee
      collaboration.accepted_at = Time.current
    end

    if collaboration.save
      if invitee
        CollaborationMailer.added(collaboration).deliver_later
        redirect_to @project, notice: "#{collaboration.invited_email} can now edit this project."
      else
        CollaborationMailer.invitation(collaboration).deliver_later
        redirect_to @project, notice: "Invitation sent to #{collaboration.invited_email}. They'll get access once they create an account."
      end
    else
      redirect_to @project, alert: collaboration.errors.full_messages.to_sentence
    end
  end

  # DELETE /projects/:project_id/collaborations/:id
  # The owner removes anyone; a collaborator may remove themselves (leave).
  def destroy
    collaboration = @project.collaborations.find(params[:id])
    authorize! :destroy, collaboration
    collaboration.destroy!

    if collaboration.user == current_user
      redirect_to projects_path, notice: "You left #{@project.title}."
    else
      redirect_to @project, notice: "Removed #{collaboration.invited_email} from this project."
    end
  end

  private

  def set_project
    @project = Project.find(params[:project_id])
  end
end
