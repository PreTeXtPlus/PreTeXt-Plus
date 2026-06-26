require "test_helper"

class DivisionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one)
    sign_in @user
  end

  test "create persists a new division under the project and returns its real id" do
    assert_difference -> { Division.count }, 1 do
      post project_divisions_url(@project, format: :json), params: {
        division: {
          ref: "intro-section",
          source_format: "pretext",
          source: "<section><title>Intro</title></section>"
        }
      }
    end

    assert_response :created
    division = Division.order(:created_at).last
    assert_equal @project, division.project
    assert_equal "intro-section", division.ref
    assert_not_equal "intro-section", division.id
    assert_equal({ "id" => division.id }, JSON.parse(response.body))
  end

  test "create rejects a ref already used by another division in the project" do
    assert_no_difference -> { Division.count } do
      post project_divisions_url(@project, format: :json), params: {
        division: {
          ref: divisions(:one).ref,
          source_format: "pretext",
          source: "<section/>"
        }
      }
    end

    assert_response :unprocessable_entity
  end

  test "create refuses to act on a project the user does not own" do
    other_project = projects(:two)

    assert_no_difference -> { Division.count } do
      post project_divisions_url(other_project, format: :json), params: {
        division: {
          ref: "intro-section",
          source_format: "pretext",
          source: "<section/>"
        }
      }
    end

    assert_response :not_found
  end
end
