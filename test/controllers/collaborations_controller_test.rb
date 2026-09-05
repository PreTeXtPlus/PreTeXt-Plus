require "test_helper"

class CollaborationsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @project = projects(:team) # subscribed owner (cap 5); has the :pending invite
    @owner = users(:subscribed)
  end

  test "owner invites an existing confirmed user, who is added immediately" do
    sign_in @owner

    assert_difference("Collaboration.count") do
      perform_enqueued_jobs do
        post project_collaborations_url(@project), params: { email: users(:one).email }
      end
    end

    collaboration = @project.collaborations.find_by(invited_email: users(:one).email)
    assert collaboration.accepted?
    assert_equal users(:one), collaboration.user
    assert_redirected_to @project

    mail = ActionMailer::Base.deliveries.last
    assert_equal [ users(:one).email ], mail.to
    assert_match "You can now edit", mail.subject
  end

  test "owner invites a registered but unconfirmed user, who is added immediately" do
    sign_in @owner
    invitee = users(:unconfirmed)
    assert_nil invitee.confirmed_at

    assert_difference("Collaboration.count") do
      perform_enqueued_jobs do
        post project_collaborations_url(@project), params: { email: invitee.email }
      end
    end

    collaboration = @project.collaborations.find_by(invited_email: invitee.email)
    assert collaboration.accepted?, "a registered account should not be left pending"
    assert_equal invitee, collaboration.user
    assert_includes invitee.reload.shared_projects, @project

    # And the owner is told the truth, rather than that the invitee must go
    # create an account they already have.
    assert_match(/can now edit/, flash[:notice])
    mail = ActionMailer::Base.deliveries.last
    assert_match "You can now edit", mail.subject
  end

  test "owner invites an unknown email, creating a pending invitation" do
    sign_in @owner

    assert_difference("Collaboration.count") do
      perform_enqueued_jobs do
        post project_collaborations_url(@project), params: { email: "somebody-new@example.com" }
      end
    end

    collaboration = @project.collaborations.find_by(invited_email: "somebody-new@example.com")
    assert_not collaboration.accepted?
    assert_nil collaboration.user

    mail = ActionMailer::Base.deliveries.last
    assert_equal [ "somebody-new@example.com" ], mail.to
    assert_match "invited you to collaborate", mail.subject
  end

  test "invite over the cap is rejected with an alert" do
    sign_in users(:one) # free owner; fixture :accepted fills the cap on project one

    assert_no_difference("Collaboration.count") do
      post project_collaborations_url(projects(:one)), params: { email: "extra@example.com" }
    end
    assert_redirected_to projects(:one)
    assert_match(/limit/i, flash[:alert])
  end

  test "non-owner cannot invite" do
    sign_in users(:one)

    assert_no_difference("Collaboration.count") do
      post project_collaborations_url(@project), params: { email: "x@example.com" }
    end
    assert_redirected_to projects_path
  end

  test "owner removes a collaborator" do
    sign_in users(:one)

    assert_difference("Collaboration.count", -1) do
      delete project_collaboration_url(projects(:one), collaborations(:accepted))
    end
    assert_redirected_to projects(:one)
  end

  test "collaborator leaves a project" do
    sign_in users(:two) # accepted collaborator on project one

    assert_difference("Collaboration.count", -1) do
      delete project_collaboration_url(projects(:one), collaborations(:accepted))
    end
    assert_redirected_to projects_path
  end

  test "outsider cannot remove a collaboration" do
    sign_in users(:subscribed)

    assert_no_difference("Collaboration.count") do
      delete project_collaboration_url(projects(:one), collaborations(:accepted))
    end
  end

  test "collaborator can edit and update the shared project" do
    sign_in users(:two)

    get edit_project_url(projects(:one))
    assert_response :success

    patch project_url(projects(:one)), params: { project: { title: "Renamed by collaborator" } }, as: :json
    assert_response :ok
    assert_equal "Renamed by collaborator", projects(:one).reload.title
  end

  test "collaborator sees the project page with a leave button, owner sees the invite form" do
    sign_in users(:two)
    get project_url(projects(:one))
    assert_response :success
    assert_match "Leave this project", response.body
    assert_no_match "Invite", response.body

    sign_in users(:one)
    get project_url(projects(:one))
    assert_response :success
    assert_match users(:two).email, response.body
  end

  test "collaborator cannot destroy the shared project" do
    sign_in users(:two)

    assert_no_difference("Project.count") do
      delete project_url(projects(:one))
    end
  end

  test "owner transfers ownership to an accepted collaborator" do
    sign_in users(:one) # owner of project one; users(:two) is its accepted collaborator

    perform_enqueued_jobs do
      patch transfer_ownership_project_collaboration_url(projects(:one), collaborations(:accepted))
    end

    assert_redirected_to projects(:one)
    assert_match(/Ownership transferred/, flash[:notice])

    project = projects(:one).reload
    assert_equal users(:two), project.user
    demoted = project.collaborations.find_by!(user: users(:one))
    assert demoted.accepted?

    mail = ActionMailer::Base.deliveries.last
    assert_equal [ users(:two).email ], mail.to
    assert_match "You're now the owner", mail.subject
  end

  test "owner cannot transfer ownership to a pending invitation" do
    sign_in users(:subscribed) # owner of project team; holds the :pending invite

    patch transfer_ownership_project_collaboration_url(projects(:team), collaborations(:pending))

    assert_redirected_to projects(:team)
    assert_match(/pending invitation/, flash[:alert])
    assert_equal users(:subscribed), projects(:team).reload.user
  end

  test "non-owner cannot transfer ownership" do
    sign_in users(:two) # collaborator, not owner, of project one

    patch transfer_ownership_project_collaboration_url(projects(:one), collaborations(:accepted))

    assert_equal users(:one), projects(:one).reload.user
  end
end
