class Ability
  include CanCan::Ability

  def initialize(user)
    # Unauthenticated users can view project source if the owner has a subscription
    can :source, Project do |project|
      project.user.has_copiable_projects?
    end

    return if user.nil?

    if user.admin?
      can :manage, :all
      return
    end

    # Own projects
    can :manage, Project, user_id: user.id
    can [ :copy, :source ], Project do |project|
      project.user.has_copiable_projects? || user.has_copiable_projects?
    end
    can :create, Project if user.projects.count < user.project_quota

    # Project assets belonging to own projects
    can :manage, ProjectAsset do |asset|
      asset.project.user_id == user.id
    end

    # Library assets
    can :manage, LibraryAsset, user_id: user.id

    # Subscriptions
    can [ :show, :seat ], Pay::Stripe::Subscription do |subscription|
      subscription.user == user
    end

    # Invitations
    can :redeem, Invitation
  end
end
