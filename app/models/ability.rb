class Ability
  include CanCan::Ability

  def initialize(user)
    # Unauthenticated users can view project source if the owner has a subscription
    can :source, Project do |project|
      project.user.has_copiable_projects?
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

    # Own projects — use specific aliases so :copy/:source can have their own rules
    can [
      :read,
      :update,
      :destroy,
      :editor_state,
      :update_editor_state
      ], Project, user_id: user.id
    can :create, Project if user.projects.count < user.project_quota

    # Copy or view source requires a subscription (owner's or current user's)
    can [ :copy, :source ], Project do |project|
      project.user.has_copiable_projects? || user.has_copiable_projects?
    end

    # Assets belonging to own projects (hash condition enables accessible_by scoping)
    can :manage, Asset, project: { user_id: user.id }

    # Divisions belonging to own projects
    can :manage, Division, project: { user_id: user.id }

    # For now, only admins can work with builds.
    # # Builds belonging to own projects
    # can :manage, Build, project: { user_id: user.id }

    can :subscribe, Announcement

    # Subscriptions
    can [ :show, :seat ], Pay::Stripe::Subscription do |subscription|
      subscription.user == user
    end
  end
end
