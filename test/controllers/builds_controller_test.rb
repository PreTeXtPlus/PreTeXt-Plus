require "test_helper"

class BuildsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one)
    sign_in @user
  end

  # index

  test "index lists builds for the project" do
    get project_builds_url(@project)
    assert_response :success
    assert_select "span", text: "Pending"
  end

  test "index only shows builds belonging to the project" do
    get project_builds_url(@project)
    assert_response :success
    assert_select "td", text: builds(:one).id, count: 0
    assert_select "td", text: builds(:two).id, count: 0
  end

  test "index redirects when the user does not own the project" do
    get project_builds_url(projects(:two))
    assert_redirected_to projects_path
  end

  # show

  test "show renders the build" do
    build = builds(:one)
    get project_build_url(@project, build)
    assert_response :success
    assert_select "span", text: "Pending"
  end

  test "show does not include download link when zip is not attached" do
    get project_build_url(@project, builds(:one))
    assert_select "a", text: "Download ZIP", count: 0
  end

  test "show includes download link when zip is attached" do
    build = builds(:one)
    build.zip.attach(
      io: StringIO.new("PK\x03\x04"),
      filename: "build.zip",
      content_type: "application/zip"
    )
    get project_build_url(@project, build)
    assert_select "a", text: "Download ZIP"
  end

  test "show returns not found for a build that belongs to a different project" do
    get project_build_url(@project, builds(:two))
    assert_response :not_found
  end

  test "show redirects when the user does not own the project" do
    get project_build_url(projects(:two), builds(:two))
    assert_redirected_to projects_path
  end

  # create

  test "create enqueues FetchBuildZipJob" do
    assert_enqueued_with(job: FetchBuildZipJob) do
      post project_builds_url(@project)
    end
  end

  test "create persists a new build and redirects to it" do
    assert_difference -> { Build.count }, 1 do
      post project_builds_url(@project), params: { build: { status: :pending } }
    end
    build = Build.order(:created_at).last
    assert_equal @project, build.project
    assert_redirected_to project_build_url(@project, build)
  end

  test "create defaults status to pending when build params are omitted" do
    post project_builds_url(@project)
    assert Build.order(:created_at).last.pending?
  end

  test "create accepts an explicit status" do
    post project_builds_url(@project), params: { build: { status: :in_progress } }
    assert Build.order(:created_at).last.in_progress?
  end

  test "create redirects when the user does not own the project" do
    assert_no_difference -> { Build.count } do
      post project_builds_url(projects(:two)), params: { build: {} }
    end
    assert_redirected_to projects_path
  end

  # destroy

  test "destroy deletes the build and redirects to index" do
    build = builds(:one)
    assert_difference -> { Build.count }, -1 do
      delete project_build_url(@project, build)
    end
    assert_redirected_to project_builds_url(@project)
  end

  test "destroy redirects when the user does not own the project" do
    assert_no_difference -> { Build.count } do
      delete project_build_url(projects(:two), builds(:two))
    end
    assert_redirected_to projects_path
  end
end
