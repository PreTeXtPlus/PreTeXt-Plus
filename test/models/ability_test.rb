require "test_helper"

class AbilityTest < ActiveSupport::TestCase
  test "collaborator can read and update but not destroy the shared project" do
    ability = Ability.new(users(:two)) # accepted collaborator on project one
    project = projects(:one)

    assert ability.can?(:read, project)
    assert ability.can?(:update, project)
    assert_not ability.can?(:destroy, project)
  end

  test "only the owner can change a shared project's visibility" do
    project = projects(:one)

    assert Ability.new(project.user).can?(:update_visibility, project)
    assert_not Ability.new(users(:two)).can?(:update_visibility, project), # accepted collaborator
      "collaborator should not be able to change visibility"
  end

  test "an unclaimed invitation grants nothing, even to the account it names" do
    project = projects(:team)
    user = users(:one)
    # Built straight through the model, so nothing linked it -- this is what a
    # pending row looks like. Access keys on the linked user_id and never on the
    # invited email, so naming an existing address must not be enough on its own.
    invitation = project.collaborations.create!(invited_email: user.email)
    assert_not invitation.accepted?

    ability = Ability.new(user)
    assert_not ability.can?(:read, project)
    assert_not ability.can?(:update, project)
  end

  test "non-collaborator cannot touch someone else's project" do
    ability = Ability.new(users(:one))
    assert_not ability.can?(:read, projects(:two))
    assert_not ability.can?(:update, projects(:two))
    assert_not ability.can?(:destroy, projects(:two))
  end

  test "collaborator can manage divisions and assets of the shared project" do
    ability = Ability.new(users(:two))
    division = projects(:one).divisions.build(ref: "extra")
    asset = projects(:one).assets.build(ref: "pic")

    assert ability.can?(:manage, division)
    assert ability.can?(:manage, asset)
  end

  test "only the owner creates collaborations; either side can destroy their own" do
    owner = Ability.new(users(:one))
    collaborator = Ability.new(users(:two))
    outsider = Ability.new(users(:subscribed))
    collaboration = collaborations(:accepted) # user two on project one

    assert owner.can?(:create, projects(:one).collaborations.build(invited_email: "x@example.com"))
    assert_not collaborator.can?(:create, projects(:one).collaborations.build(invited_email: "x@example.com"))

    assert owner.can?(:destroy, collaboration)
    assert collaborator.can?(:destroy, collaboration), "collaborator should be able to leave"
    assert_not outsider.can?(:destroy, collaboration)
  end

  test "collaborator gets the whole build pipeline on a shared project" do
    ability = Ability.new(users(:two)) # accepted collaborator on project one
    project = projects(:one)
    target = project.targets.first

    assert ability.can?(:download, project)
    assert ability.can?(:read, target)
    assert ability.can?(:manage, target)
    assert ability.can?(:create, Build.new(project: project, target: target))
  end

  test "target quota follows the project owner's plan, not the collaborator's" do
    # users(:one) owns project one and is unsubscribed (quota 3); the fixture
    # collaborator users(:two) is likewise unsubscribed. Fill the owner's quota
    # and the collaborator must be refused on the owner's limit.
    project = projects(:one)
    ability = Ability.new(users(:two))
    until project.targets.count >= project.user.target_quota
      project.targets.create!(name: "Extra #{project.targets.count}", kind: "website")
    end

    assert_not ability.can?(:create, Target.new(project: project, name: "One more", kind: "website")),
      "collaborator should be stopped by the owner's target quota"
  end

  test "a stranger gets no build access to someone else's project" do
    ability = Ability.new(users(:subscribed))
    project = projects(:one)
    target = project.targets.first

    assert_not ability.can?(:read, target)
    assert_not ability.can?(:manage, target)
    assert_not ability.can?(:create, Build.new(project: project, target: target))
    assert_not ability.can?(:download, project)
  end

  test "any signed-in user can create a project regardless of how many they already own" do
    ability = Ability.new(users(:one))
    assert ability.can?(:create, Project)
  end

  test "accessible_by includes shared projects for a collaborator" do
    accessible = Project.accessible_by(Ability.new(users(:two)), :update)
    assert_includes accessible, projects(:one)
    assert_includes accessible, projects(:two)
  end

  test "a basic requester cannot copy or view source of another basic user's private project" do
    ability = Ability.new(users(:two))
    project = projects(:one) # owned by user :one, neither side subscribed, defaults to private

    assert project.private_visibility?
    assert_not ability.can?(:copy, project)
    assert_not ability.can?(:source, project)
  end

  test "build_all follows the project owner's subscription, not the collaborator's" do
    project = projects(:one) # owner :one (unsubscribed), collaborator :two (unsubscribed)

    assert_not Ability.new(project.user).can?(:build_all, project)
    assert_not Ability.new(users(:two)).can?(:build_all, project)

    project.update!(user: users(:subscribed))

    assert Ability.new(project.user).can?(:build_all, project)
    assert Ability.new(users(:two)).can?(:build_all, project),
      "collaborator should get build_all once the OWNER is subscribed"
  end

  test "a subscribed collaborator does not unlock build_all on an unsubscribed owner's project" do
    project = projects(:one)
    # Swap the collaborator fixture to be the subscribed user while the owner stays
    # unsubscribed -- proves the check reads the owner's plan, not the actor's.
    collaborations(:accepted).update!(user: users(:subscribed))

    assert_not Ability.new(users(:subscribed)).can?(:build_all, project)
  end

  test "an admin can build_all regardless of subscription" do
    project = projects(:one)
    assert_not project.user.subscribed?

    admin = users(:two)
    admin.update!(admin: true)

    assert Ability.new(admin).can?(:build_all, project)
  end

  test "a basic requester can copy or view source of another basic user's public or unlisted project" do
    ability = Ability.new(users(:two))
    project = projects(:one) # owned by user :one, neither side subscribed

    project.visibility = :public
    assert ability.can?(:copy, project)
    assert ability.can?(:source, project)

    project.visibility = :unlisted
    assert ability.can?(:copy, project)
    assert ability.can?(:source, project)
  end
end
