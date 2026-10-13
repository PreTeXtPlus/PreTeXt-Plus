require "test_helper"

class CollaborationTest < ActiveSupport::TestCase
  test "normalizes invited_email like User does" do
    collaboration = Collaboration.new(invited_email: "  MixedCase@Example.COM ")
    assert_equal "mixedcase@example.com", collaboration.invited_email
  end

  test "rejects an invalid email address" do
    collaboration = projects(:two).collaborations.build(invited_email: "not-an-email")
    assert_not collaboration.valid?
    assert collaboration.errors[:invited_email].any?
  end

  test "rejects inviting the project owner" do
    project = projects(:one)
    collaboration = project.collaborations.build(invited_email: project.user.email)
    assert_not collaboration.valid?
    assert_includes collaboration.errors[:invited_email], "already owns this project"
  end

  test "rejects a duplicate invite on the same project" do
    project = projects(:team)
    collaboration = project.collaborations.build(invited_email: collaborations(:pending).invited_email)
    assert_not collaboration.valid?
    assert collaboration.errors[:invited_email].any?
  end

  # COLLAB PREVIEW CLEANUP (after Nov 1, 2026): unwrap the travel_to block.
  test "free owner is capped at 1 collaborator" do
    travel_to Project::COLLABORATION_PREVIEW_ENDS do
      project = projects(:one) # owner is the unsubscribed user one; fixture :accepted fills the cap
      assert_equal 1, project.collaborator_limit
      collaboration = project.collaborations.build(invited_email: "extra@example.com")
      assert_not collaboration.valid?
      assert_match(/limit/i, collaboration.errors[:base].to_sentence)
    end
  end

  # COLLAB PREVIEW CLEANUP (after Nov 1, 2026): delete this test.
  test "free owner is uncapped during the collaboration preview" do
    travel_to Project::COLLABORATION_PREVIEW_ENDS - 1.second do
      project = projects(:one) # the cap that fixture :accepted fills after the preview
      assert project.collaborations.create(invited_email: "extra@example.com").persisted?
    end
  end

  # COLLAB PREVIEW CLEANUP (after Nov 1, 2026): unwrap the travel_to block.
  test "subscribed owner has no collaborator cap" do
    travel_to Project::COLLABORATION_PREVIEW_ENDS do
      project = Project.create!(user: users(:subscribed), title: "Team book")
      assert_equal Float::INFINITY, project.collaborator_limit
      10.times do |n|
        assert project.collaborations.create(invited_email: "person#{n}@example.com").persisted?
      end
    end
  end

  test "cap is not enforced on existing rows (grandfathering)" do
    # The fixture :accepted already fills the free cap on project one; the
    # existing row must remain valid even though nothing new may be added.
    assert collaborations(:accepted).valid?
  end

  test "claim_for links pending invites matching the user's email" do
    user = User.create!(name: "Newbie", email: "invited@example.com",
                        password: "password123", confirmed_at: Time.current)
    Collaboration.claim_for(user)

    collaboration = collaborations(:pending).reload
    assert_equal user, collaboration.user
    assert collaboration.accepted?
    assert_includes user.shared_projects, projects(:team)
  end

  test "claim_for discards an invite to a project the user already edits" do
    project = projects(:one)
    user = users(:two) # already an accepted collaborator on project one
    invite = Collaboration.new(project: project, user: nil, invited_email: "second@example.com")
    invite.save!(validate: false) # over-cap pending row, as if from a lapsed subscription

    user.stub(:email, "second@example.com") do
      Collaboration.claim_for(user)
    end
    assert_not Collaboration.exists?(invite.id)
    assert_equal 1, user.collaborations.where(project: project).count
  end
end
