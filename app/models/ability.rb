class Ability
  include CanCan::Ability

  def initialize(user)
    # Unauthenticated users can view project source if the owner has a subscription
    can :source, Project do |project|
      project.user.has_copiable_projects?
    end

    can :read, Announcement do |announcement|
      announcement.published?
    end

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

    # Project assets belonging to own projects (hash condition enables accessible_by scoping)
    can :manage, ProjectAsset, project: { user_id: user.id }

    # Divisions belonging to own projects
    can :manage, Division, project: { user_id: user.id }

    # Library assets — :create has no user_id yet at authorization time, so it's a separate rule
    can :create, LibraryAsset
    can [ :read, :update, :destroy, :preview_file ], LibraryAsset, user_id: user.id

    # Subscriptions
    can [ :show, :seat ], Pay::Stripe::Subscription do |subscription|
      subscription.user == user
    end
  end
end
