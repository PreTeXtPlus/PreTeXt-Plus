require "test_helper"

class ProjectsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    @user = users(:one)
    post session_path, params: { email: @user.email, password: "password" }
  end

  test "should get index" do
    get projects_url
    assert_response :success
  end

  test "should get new" do
    get new_project_url
    assert_response :success
  end

  test "should create project and redirect to editor" do
    stub_build_server do
      assert_difference("Project.count") do
        post projects_url, params: { project: { title: "My New Project", source_format: "pretext" } }
      end
    end

    created = Project.find_by!(title: "My New Project", user: @user)
    assert_redirected_to edit_project_url(created)
  end

  test "should create project with latex source format" do
    stub_build_server do
      assert_difference("Project.count") do
        post projects_url, params: { project: { title: "LaTeX Project", source_format: "latex" } }
      end
    end

    created = Project.find_by!(title: "LaTeX Project", user: @user)
    assert created.latex_source_format?
    assert_redirected_to edit_project_url(created)
  end

  test "should default title when blank on create" do
    stub_build_server do
      assert_difference("Project.count") do
        post projects_url, params: { project: { title: "", source_format: "pretext" } }
      end
    end

    assert_match %r{/projects/[0-9a-f-]+/edit$}, response.location
    assert Project.exists?(title: "New Project", user: @user)
  end

  test "should show project" do
    get project_url(@project)
    assert_response :success
  end

  test "should get edit" do
    get edit_project_url(@project)
    assert_response :success
  end

  test "should update project" do
    stub_build_server do
      patch project_url(@project), params: { project: { source: @project.source, title: @project.title } }
    end
    assert_redirected_to project_url(@project)
  end

  test "should ignore invalid source_format and not raise 500" do
    stub_build_server do
      assert_difference("Project.count") do
        post projects_url, params: { project: { title: "Bad Format", source_format: "bogus" } }
      end
    end

    created = Project.find_by!(title: "Bad Format", user: @user)
    assert created.pretext_source_format?  # falls back to default (first enum value)
  end

  test "should destroy project" do
    assert_difference("Project.count", -1) do
      delete project_url(@project)
    end

    assert_redirected_to projects_url
  end

  test "non-owner cannot view project" do
    other_project = projects(:two)
    get project_url(other_project)
    assert_redirected_to projects_path
  end

  test "non-owner cannot edit project" do
    other_project = projects(:two)
    get edit_project_url(other_project)
    assert_redirected_to projects_path
  end

  test "non-owner cannot update project" do
    other_project = projects(:two)
    stub_build_server do
      patch project_url(other_project), params: { project: { title: "Stolen" } }
    end
    assert_redirected_to projects_path
    assert_not_equal "Stolen", other_project.reload.title
  end

  test "non-owner cannot destroy project" do
    other_project = projects(:two)
    assert_no_difference("Project.count") do
      delete project_url(other_project)
    end
    assert_redirected_to projects_path
  end

  test "admin can view any project" do
    @user.update!(admin: true)
    other_project = projects(:two)
    get project_url(other_project)
    assert_response :success
  end

  test "share is publicly accessible without authentication" do
    delete session_path  # sign out
    get project_share_url(@project)
    assert_response :success
  end

  test "copy creates a duplicate for sustaining subscriber" do
    @user.update!(subscription: :sustaining)
    stub_build_server do
      assert_difference("Project.count") do
        post project_copy_url(@project)
      end
    end
    copy = Project.find_by!(title: "Copy of #{@project.title}", user: @user)
    assert_redirected_to edit_project_path(copy)
  end

  test "copy is blocked for beta subscribers" do
    @user.update!(subscription: :beta, admin: false)
    assert_no_difference("Project.count") do
      post project_copy_url(@project)
    end
    assert_redirected_to projects_path
  end
end
