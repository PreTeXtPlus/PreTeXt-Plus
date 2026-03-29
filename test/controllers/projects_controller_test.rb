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
      patch project_url(@project), params: { project: { content: @project.content, title: @project.title } }
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
end
