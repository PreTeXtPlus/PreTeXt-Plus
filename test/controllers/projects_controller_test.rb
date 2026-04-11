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

  test "should reject invalid source_format on create" do
    assert_no_difference("Project.count") do
      post projects_url, params: { project: { title: "Bad Format", source_format: "bogus" } }
    end

    assert_response :unprocessable_entity
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

  test "copy allows sustaining requester to copy another user's project" do
    owner = users(:one)
    owner.update!(subscription: :beta, admin: false)
    requester = users(:two)
    requester.update!(subscription: :sustaining, admin: false)
    other_project = projects(:one)

    delete session_path
    sign_in_as(requester)

    stub_build_server do
      assert_difference("Project.count", 1) do
        post project_copy_url(other_project)
      end
    end
    copied = Project.find_by!(title: "Copy of #{other_project.title}", user: requester)
    assert_redirected_to edit_project_path(copied)
  end

  test "copy blocks beta requester even when source owner is sustaining" do
    owner = users(:one)
    owner.update!(subscription: :sustaining, admin: false)
    requester = users(:two)
    requester.update!(subscription: :beta, admin: false)
    other_project = projects(:one)

    delete session_path
    sign_in_as(requester)

    assert_no_difference("Project.count") do
      post project_copy_url(other_project)
    end
    assert_redirected_to projects_path
  end

  test "preview is accessible without authentication" do
    delete session_path  # sign out
    stub_preview_server do
      post preview_url, params: { source: "<section><title>Test</title></section>", title: "Test" }
    end
    assert_response :success
  end

  test "preview returns build server response body" do
    expected_body = "<html><body><p>Hello World</p></body></html>"
    stub_preview_server(body: expected_body) do
      post preview_url, params: { source: "<section/>", title: "Test" }
    end
    assert_response :success
    assert_includes response.body, "Hello World"
  end

  test "preview returns bad_gateway when build server connection fails" do
    stub_preview_server(raise_error: Errno::ECONNREFUSED.new) do
      post preview_url, params: { source: "<section/>", title: "Test" }
    end
    assert_response :bad_gateway
  end

  test "preview returns gateway_timeout when build server times out" do
    stub_preview_server(raise_error: Net::ReadTimeout.new) do
      post preview_url, params: { source: "<section/>", title: "Test" }
    end
    assert_response :gateway_timeout
  end

  # --- Docinfo ---

  test "should update docinfo" do
    custom_docinfo = "<docinfo><macros>\\newcommand{\\N}{\\mathbb{N}}</macros></docinfo>"
    stub_build_server do
      patch project_url(@project), params: {
        project: {
          docinfo: custom_docinfo
        }
      }
    end
    assert_redirected_to @project

    @project.reload
  assert_equal custom_docinfo, @project.docinfo
  end

  # --- Editor state API ---

  test "should get editor_state as json" do
    get editor_state_project_url(@project), headers: { "Accept" => "application/json" }
    assert_response :success
    json = response.parsed_body
    assert_includes json.keys, "title"
    assert_includes json.keys, "source"
    assert_includes json.keys, "source_format"
    assert_includes json.keys, "pretext_source"
    assert_includes json.keys, "docinfo"
  end

  test "editor_state includes docinfo value" do
    expected_docinfo = "<docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>"
    @project.update_column(:docinfo, expected_docinfo)
    get editor_state_project_url(@project), headers: { "Accept" => "application/json" }
    json = response.parsed_body
    assert_equal expected_docinfo, json["docinfo"]
  end

  test "should update_editor_state via patch" do
    stub_build_server do
      patch editor_state_project_url(@project),
        params: { project: { title: "API Title", source: "new source", docinfo: "<docinfo/>" } },
        as: :json
    end
    assert_response :success
    json = response.parsed_body
    assert_equal "API Title", json["title"]
    assert_equal "API Title", @project.reload.title
    assert_equal "<docinfo/>", @project.docinfo
  end

  test "docinfo-only editor_state update triggers rebuild" do
    captured_params = nil
    fake_response = Struct.new(:body).new("<html><body>docinfo-only</body></html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) {
      captured_params = params
      fake_response
    }) do
      patch editor_state_project_url(@project),
        params: { project: { docinfo: "<docinfo><macros>\\newcommand{\\Q}{\\mathbb{Q}}</macros></docinfo>" } },
        as: :json
    end

    assert_response :success
    assert_includes captured_params[:source], "<docinfo><macros>\\newcommand{\\Q}{\\mathbb{Q}}</macros></docinfo>"
    assert_equal "<html><body>docinfo-only</body></html>", @project.reload.html_source
  end

  test "should reject invalid source_format in editor_state update" do
    original_format = @project.source_format
    stub_build_server do
      patch editor_state_project_url(@project),
        params: { project: { title: "Bad API Format", source_format: "bogus" } },
        as: :json
    end

    assert_response :unprocessable_entity
    assert_not_equal "Bad API Format", @project.reload.title
    assert_equal original_format, @project.source_format
  end

  test "non-owner cannot get editor_state" do
    other_project = projects(:two)
    get editor_state_project_url(other_project), headers: { "Accept" => "application/json" }
    assert_redirected_to projects_path
  end

  test "non-owner cannot update_editor_state" do
    other_project = projects(:two)
    patch editor_state_project_url(other_project),
      params: { project: { title: "Stolen" } },
      as: :json
    assert_redirected_to projects_path
    assert_not_equal "Stolen", other_project.reload.title
  end

  test "unauthenticated user cannot get editor_state" do
    delete session_path
    get editor_state_project_url(@project), headers: { "Accept" => "application/json" }
    assert_response :redirect
  end
end
