class Ability
  include CanCan::Ability

  def initialize(user)
    # Anyone may read the build a published target currently points at. The
    # current_build_id clause is what makes unpublishing effective and keeps superseded
    # builds private: without it, any build URL would stay readable forever once its
    # target had been published even once.
    can :read, Build do |build|
      build.target.published? && build.target.current_build_id == build.id
    end

    can :read, Announcement do |announcement|
      if !announcement.published?
        false
      elsif announcement.paid_subscribers_only? && !user&.subscribed?
        false
      else
        true
      end
    end
    can :unsubscribe, Announcement

    return if user.nil?

    if user.admin?
      can :manage, :all
      return
    end

    # Manage projects
    can :manage, Project, user_id: user.id
    # Shared projects: a collaborator is a co-author, so they get everything the
    # owner has except destroying the project — that stays with whoever owns it.
    can [
      :read,
      :update,
      :download,
      :editor_state,
      :update_editor_state
      ], Project, collaborations: { user_id: user.id }
    # Copying and viewing source is allowed provided the project is not private.
    can [ :copy, :source ], Project do |project|
      !project.private_visibility?
    end

    # Assets belonging to own projects (hash condition enables accessible_by scoping)
    can :manage, Asset, project: { user_id: user.id }
    can :manage, Asset, project: { collaborations: { user_id: user.id } }

    # Divisions belonging to own projects
    can :manage, Division, project: { user_id: user.id }
    can :manage, Division, project: { collaborations: { user_id: user.id } }

    # Only the owner manages who collaborates; a collaborator may remove
    # (only) their own row to leave the project.
    can [ :create, :destroy ], Collaboration, project: { user_id: user.id }
    can :destroy, Collaboration, user_id: user.id

    # Targets and builds belonging to own projects. Build volume is bounded by the rate
    # limit and concurrency cap in BuildsController rather than by who is signed in.
    can :manage, Target, project: { user_id: user.id }
    # Collaborators get the same build pipeline: a co-author who can rewrite every
    # division but cannot build the result could never check their own work. Must
    # precede the `cannot :create` below, or it would re-grant :create unquota'd.
    can :manage, Target, project: { collaborations: { user_id: user.id } }
    # Creating one more is additionally bounded by quota. The `cannot` is required: a
    # block that returns false does not *match*, so without it CanCan would fall back to
    # the broader :manage rule above and allow the create anyway.
    cannot :create, Target
    can :create, Target do |target|
      project = target.project
      # Quota follows the OWNER's plan, exactly like collaborator_limit: what a
      # project may cost belongs to whoever owns it, and a collaborator's own
      # subscription says nothing about someone else's project.
      project.present? && project.editable_by?(user) &&
        project.targets.count < project.user.target_quota
    end
    can :manage, Build, project: { user_id: user.id }
    can :manage, Build, project: { collaborations: { user_id: user.id } }

    can :subscribe, Announcement

    # Subscriptions
    can [ :show, :seat ], Pay::Stripe::Subscription do |subscription|
      subscription.user == user
    end
  end
end
