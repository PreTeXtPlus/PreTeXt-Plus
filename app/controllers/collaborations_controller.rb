class CollaborationsController < ApplicationController
  before_action :set_project

  # POST /projects/:project_id/collaborations
  # Invite by email. Any registered account under that address becomes a
  # collaborator immediately; only an address with no account at all sits
  # pending, until someone registers or confirms it (Collaboration.claim_for).
  def create
    collaboration = @project.collaborations.build(invited_email: params[:email])
    authorize! :create, collaboration

    # Registration, not confirmation, is the bar. An unconfirmed account is a
    # working account everywhere else in the app -- Devise is configured with
    # allow_unconfirmed_access_for, so its owner can sign in and edit their own
    # projects -- and treating it as nonexistent here produced the worst of both
    # worlds: a pending invite plus a message telling a signed-in user to go make
    # the account they already had.
    invitee = User.find_by(email: collaboration.invited_email)
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

  # PATCH /projects/:project_id/collaborations/:id/transfer_ownership
  # Owner-only. Hands the project to this (accepted) collaborator and demotes
  # the current owner to a collaborator in their place.
  def transfer_ownership
    collaboration = @project.collaborations.find(params[:id])
    authorize! :transfer_ownership, collaboration

    new_owner = collaboration.user
    if new_owner.nil?
      redirect_to @project, alert: "Can't transfer ownership to a pending invitation." and return
    end

    previous_owner = current_user
    if @project.transfer_ownership_to!(new_owner)
      CollaborationMailer.ownership_transferred(@project, previous_owner).deliver_later
      redirect_to @project, notice: "Ownership transferred to #{new_owner.name_with_email}. You are now a collaborator on this project."
    else
      redirect_to @project, alert: "Couldn't transfer ownership."
    end
  end

  private

  def set_project
    @project = Project.find(params[:project_id])
  end
end
