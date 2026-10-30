require "test_helper"

class CollaborationsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @project = projects(:team) # subscribed owner (uncapped); has the :pending invite
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
    travel_to Project::COLLABORATION_PREVIEW_ENDS # COLLAB PREVIEW CLEANUP (after Nov 1, 2026): delete this line.
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

  test "bulk add invites a list split on commas, semicolons, and new lines" do
    sign_in @owner

    assert_difference("Collaboration.count", 4) do
      perform_enqueued_jobs do
        post bulk_project_collaborations_url(@project),
             params: { emails: "#{users(:one).email}, a@example.com; b@example.com\r\nC@example.com,, a@example.com" }
      end
    end

    assert_redirected_to @project
    assert_equal "Invited 4 people.", flash[:notice]

    # Same treatment as a single invite: an account is added, an unknown address waits.
    assert @project.collaborations.find_by(invited_email: users(:one).email).accepted?
    assert_not @project.collaborations.find_by(invited_email: "c@example.com").accepted?
    assert_equal 4, ActionMailer::Base.deliveries.last(4).map(&:to).flatten.uniq.size
  end

  test "bulk add takes the address out of a display name" do
    sign_in @owner

    assert_difference("Collaboration.count", 2) do
      post bulk_project_collaborations_url(@project),
           params: { emails: "First Last <First.Last@example.com>, \"Other Person\" <other@example.com>" }
    end

    assert_equal "Invited 2 people.", flash[:notice]
    assert @project.collaborations.exists?(invited_email: "first.last@example.com")
    assert @project.collaborations.exists?(invited_email: "other@example.com")
  end

  test "bulk add doesn't split on spaces, and says so rather than dropping the entry" do
    sign_in @owner

    assert_no_difference("Collaboration.count") do
      post bulk_project_collaborations_url(@project), params: { emails: "a@example.com b@example.com" }
    end
    assert_match "a@example.com b@example.com (Invited email is not a valid email address)", flash[:alert]
  end

  test "bulk add invites the good addresses and names the ones it couldn't" do
    sign_in @owner
    pending = collaborations(:pending).invited_email

    assert_difference("Collaboration.count", 1) do
      post bulk_project_collaborations_url(@project), params: { emails: "good@example.com, not-an-email, #{pending}, #{@owner.email}" }
    end

    assert_redirected_to @project
    assert_nil flash[:notice], "the layout hides an alert behind a notice"
    assert_match "Invited 1 person.", flash[:alert]
    assert_match "not-an-email (Invited email is not a valid email address)", flash[:alert]
    assert_match "#{pending} (Invited email has already been invited)", flash[:alert]
    assert_match "#{@owner.email} (Invited email already owns this project)", flash[:alert]
  end

  test "a free owner cannot bulk add, even during the collaboration preview" do
    sign_in users(:one) # free owner of project one
    assert Project.collaboration_preview?

    assert_no_difference("Collaboration.count") do
      post bulk_project_collaborations_url(projects(:one)), params: { emails: "x@example.com, y@example.com" }
    end
    assert_redirected_to projects_path
  end

  test "bulk add with nothing in it is rejected with an alert" do
    sign_in @owner

    assert_no_difference("Collaboration.count") do
      post bulk_project_collaborations_url(@project), params: { emails: " ,; " }
    end
    assert_match(/at least one/, flash[:alert])
  end

  test "bulk add refuses a list longer than an hour's allowance outright" do
    sign_in @owner
    emails = (1..CollaborationsController::SUBSCRIBER_INVITES_PER_HOUR + 1).map { |n| "person#{n}@example.com" }

    assert_no_difference("Collaboration.count") do
      post bulk_project_collaborations_url(@project), params: { emails: emails.join(",") }
    end
    assert_match(/up to #{CollaborationsController::SUBSCRIBER_INVITES_PER_HOUR}/, flash[:alert])
  end

  test "bulk add draws on the same allowance as single invites" do
    sign_in @owner
    allowance_left = 2
    counts = Hash.new(CollaborationsController::SUBSCRIBER_INVITES_PER_HOUR - allowance_left)

    Rails.cache.stub(:increment, ->(key, amount = 1, *) { counts[key] += amount }) do
      # Addresses that can't be invited send no email, so they spend nothing.
      assert_difference("Collaboration.count", allowance_left) do
        post bulk_project_collaborations_url(@project),
             params: { emails: "not-an-email, a@example.com, b@example.com, c@example.com, d@example.com" }
      end
      assert_match "Invited 2 people.", flash[:alert]
      assert_match "c@example.com, d@example.com (You've sent a lot", flash[:alert]

      assert_no_difference("Collaboration.count") do
        post project_collaborations_url(@project), params: { email: "e@example.com" }
      end
      assert_match(/You've sent a lot/, flash[:alert])
    end
  end

  test "subscribers get a higher hourly allowance than free owners" do
    counts = Hash.new(CollaborationsController::INVITES_PER_HOUR)

    Rails.cache.stub(:increment, ->(key, amount = 1, *) { counts[key] += amount }) do
      sign_in users(:one) # free owner of project one
      assert_no_difference("Collaboration.count") do
        post project_collaborations_url(projects(:one)), params: { email: "free@example.com" }
      end
      assert_match(/You've sent a lot/, flash[:alert])

      counts.clear
      sign_in @owner
      assert_difference("Collaboration.count") do
        post project_collaborations_url(@project), params: { email: "paid@example.com" }
      end
    end
  end

  test "bulk add failures can't overflow the session cookie" do
    sign_in @owner
    junk = (1..CollaborationsController::SUBSCRIBER_INVITES_PER_HOUR).map { |n| "#{n}-#{"x" * 200}" }

    post bulk_project_collaborations_url(@project), params: { emails: junk.join(",") }

    assert_redirected_to @project
    assert_match "Invited 0 people.", flash[:alert]
  end

  test "non-owner cannot bulk add" do
    sign_in users(:one)

    assert_no_difference("Collaboration.count") do
      post bulk_project_collaborations_url(@project), params: { emails: "x@example.com" }
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
    assert_no_match "Bulk add", response.body

    sign_in users(:one)
    get project_url(projects(:one))
    assert_response :success
    assert_match users(:two).email, response.body
    assert_no_match "Bulk add", response.body

    sign_in @owner
    get project_url(@project)
    assert_response :success
    assert_match "Bulk add", response.body
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
