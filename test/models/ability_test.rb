require "test_helper"

class AbilityTest < ActiveSupport::TestCase
  test "collaborator can read and update but not destroy the shared project" do
    ability = Ability.new(users(:two)) # accepted collaborator on project one
    project = projects(:one)

    assert ability.can?(:read, project)
    assert ability.can?(:update, project)
    assert_not ability.can?(:destroy, project)
  end

  test "a pending invite grants nothing" do
    stranger = User.create!(name: "Pending", email: "invited@example.com",
                            password: "password123", confirmed_at: nil)
    # Fixture :pending invites this email to the team project, but the row is
    # unclaimed (user_id nil), so no access yet.
    ability = Ability.new(stranger)
    assert_not ability.can?(:read, projects(:team))
    assert_not ability.can?(:update, projects(:team))
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

  test "accessible_by includes shared projects for a collaborator" do
    accessible = Project.accessible_by(Ability.new(users(:two)), :update)
    assert_includes accessible, projects(:one)
    assert_includes accessible, projects(:two)
  end
end
