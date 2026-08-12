require "test_helper"

class CollabIncidentsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    @user = users(:one)
    sign_in @user
  end

  def report(params)
    post collab_incidents_url, params: params, as: :json
  end

  test "accepts each reportable kind and notifies Honeybadger" do
    CollabIncidentsController::KINDS.each do |kind|
      notified = capture_notifications do
        report(kind: kind, project_id: @project.id)
      end

      assert_response :accepted
      assert_equal 1, notified.size, "expected #{kind} to notify once"
      assert_equal "Collab::#{kind.camelize}", notified.first[:error_class]
      assert_equal @project.id, notified.first[:context][:project_id]
      assert_equal @user.id, notified.first[:context][:user_id]
    end
  end

  test "rejects a kind that isn't one of the known few" do
    notified = capture_notifications do
      report(kind: "something_invented", project_id: @project.id)
    end

    assert_response :unprocessable_entity
    assert_empty notified
  end

  test "accepts a report from a collaborator, not just the project owner" do
    sign_out @user
    # users(:two) collaborates on projects(:one) -- the reports worth having come
    # from exactly this kind of session.
    sign_in users(:two)

    notified = capture_notifications do
      report(kind: "relay_stalled", project_id: @project.id)
    end

    assert_response :accepted
    assert_equal 1, notified.size
  end

  test "rejects a report about a project the reporter cannot edit" do
    sign_out @user
    sign_in users(:subscribed)

    notified = capture_notifications do
      report(kind: "relay_stalled", project_id: @project.id)
    end

    assert_response :forbidden
    assert_empty notified
  end

  test "rejects a report about a project that does not exist" do
    notified = capture_notifications do
      report(kind: "relay_stalled", project_id: SecureRandom.uuid)
    end

    assert_response :forbidden
    assert_empty notified
  end

  test "requires a signed-in reporter" do
    sign_out @user

    notified = capture_notifications do
      report(kind: "relay_stalled", project_id: @project.id)
    end

    assert_response :unauthorized
    assert_empty notified
  end

  test "carries the detail and silence duration into the report, truncating detail" do
    detail = "x" * (CollabIncidentsController::MAX_DETAIL_LENGTH + 50)

    notified = capture_notifications do
      report(kind: "relay_stalled", project_id: @project.id, detail: detail, silent_for_seconds: "42")
    end

    context = notified.first[:context]
    assert_equal 42, context[:silent_for_seconds]
    assert_equal CollabIncidentsController::MAX_DETAIL_LENGTH, context[:detail].length
  end

  test "omits blank optional fields rather than reporting empty ones" do
    notified = capture_notifications do
      report(kind: "join_failed", project_id: @project.id)
    end

    context = notified.first[:context]
    assert_not context.key?(:detail)
    assert_not context.key?(:silent_for_seconds)
  end

  private

    # Honeybadger is configured not to report in test (config/honeybadger.yml), so
    # notifications are captured here rather than observed through the gem.
    def capture_notifications
      captured = []
      Honeybadger.stub(:notify, ->(message, **options) { captured << options.merge(message: message) }) do
        yield
      end
      captured
    end
end
