class CollaborationsController < ApplicationController
  # Each invite emails an arbitrary address, and with no collaborator cap for
  # subscribers (or anyone, during a preview) nothing else bounds how many.
  # Counted per address rather than per request (hence not rate_limit), so a list
  # pasted into #bulk_create draws on the same allowance as inviting one at a
  # time instead of being a way around it. Which allowance applies follows the
  # OWNER's plan, like Project#collaborator_limit.
  INVITES_PER_HOUR = 30
  SUBSCRIBER_INVITES_PER_HOUR = 100
  TOO_MANY_INVITES = "You've sent a lot of invitations recently. Please wait a while and try again."

  # The flash lives in the session cookie, and a failed bulk invite echoes back
  # whatever was pasted; past 4KB the cookie overflows and the request 500s.
  MAX_FLASH_LENGTH = 1000

  before_action :set_project
  before_action :enforce_invite_limit, only: :create

  # POST /projects/:project_id/collaborations
  # Invite by email. Any registered account under that address becomes a
  # collaborator immediately; only an address with no account at all sits
  # pending, until someone registers or confirms it (Collaboration.claim_for).
  def create
    collaboration = @project.collaborations.build(invited_email: params[:email])
    authorize! :create, collaboration

    if !invite(collaboration)
      redirect_to @project, alert: collaboration.errors.full_messages.to_sentence
    elsif collaboration.accepted?
      redirect_to @project, notice: "#{collaboration.invited_email} can now edit this project."
    else
      redirect_to @project, notice: "Invitation sent to #{collaboration.invited_email}. They'll get access once they create an account."
    end
  end

  # POST /projects/:project_id/collaborations/bulk
  # #create for each address in a pasted list. Each one stands alone: a bad
  # address doesn't hold up the rest, and the flash names any that didn't go
  # through so they can be fixed and resubmitted. Spaces don't separate entries,
  # so that a mail client's "First Last <first.last@example.com>" stays whole.
  def bulk_create
    authorize! :bulk_create, Collaboration.new(project: @project)

    emails = params[:emails].to_s.split(/[,;\r\n]+/)
      .map { |entry| Collaboration.normalize_value_for(:invited_email, entry[/<(.+?)>/, 1] || entry) }
      .reject(&:empty?).uniq

    if emails.empty?
      redirect_to @project, alert: "Enter at least one email address." and return
    elsif emails.size > SUBSCRIBER_INVITES_PER_HOUR
      redirect_to @project, alert: "You can invite up to #{SUBSCRIBER_INVITES_PER_HOUR} people at a time." and return
    end

    invited = 0
    failures = Hash.new { |hash, reason| hash[reason] = [] }
    emails.each do |email|
      collaboration = @project.collaborations.build(invited_email: email)
      if collaboration.valid? && !invite_allowed?
        failures[TOO_MANY_INVITES] << email
      elsif invite(collaboration)
        invited += 1
      else
        failures[collaboration.errors.full_messages.to_sentence] << email
      end
    end

    # One message either way: the layout shows an alert only when there's no notice.
    summary = "Invited #{invited} #{"person".pluralize(invited)}."
    if failures.empty?
      redirect_to @project, notice: summary
    else
      details = failures.map { |reason, addresses| "#{addresses.join(", ")} (#{reason})" }.join("; ")
      redirect_to @project, alert: "#{summary} Not invited: #{details}".truncate(MAX_FLASH_LENGTH)
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

  def enforce_invite_limit
    redirect_to @project, alert: TOO_MANY_INVITES unless invite_allowed?
  end

  # Spends one invite from this hour's allowance. The test environment's
  # :null_store counts nothing and returns nil.
  def invite_allowed?
    count = Rails.cache.increment("invites:#{request.remote_ip}", 1, expires_in: 1.hour)
    count.nil? || count <= (@project.user.has_subscriber_benefits? ? SUBSCRIBER_INVITES_PER_HOUR : INVITES_PER_HOUR)
  end

  # Saves the collaboration and emails the invitee, returning whether it saved.
  #
  # Registration, not confirmation, is the bar. An unconfirmed account is a
  # working account everywhere else in the app -- Devise is configured with
  # allow_unconfirmed_access_for, so its owner can log in and edit their own
  # projects -- and treating it as nonexistent here produced the worst of both
  # worlds: a pending invite plus a message telling a logged-in user to go make
  # the account they already had.
  def invite(collaboration)
    invitee = User.find_by(email: collaboration.invited_email)
    if invitee
      collaboration.user = invitee
      collaboration.accepted_at = Time.current
    end
    return false unless collaboration.save

    if invitee
      CollaborationMailer.added(collaboration).deliver_later
    else
      CollaborationMailer.invitation(collaboration).deliver_later
    end
    true
  end
end
