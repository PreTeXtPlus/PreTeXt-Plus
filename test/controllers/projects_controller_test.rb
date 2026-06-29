require "test_helper"

class ProjectsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  setup do
    @project = projects(:one)
    @user = users(:one)
    sign_in @user
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
        post projects_url, params: { project: { title: "My New Project" } }
      end
    end

    created = Project.find_by!(title: "My New Project", user: @user)
    assert_redirected_to edit_project_url(created)
  end

  test "should default title when blank on create" do
    stub_build_server do
      assert_difference("Project.count") do
        post projects_url, params: { project: { title: "" } }
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
    patch project_url(@project), params: { project: { title: @project.title } }, as: :json
    assert_response :ok
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
    sign_out :user  # sign out
    get share_project_url(@project)
    assert_response :success
  end

  test "copy creates a duplicate for subscriber" do
    subbed_user = users(:subscribed)
    sign_out :user
    sign_in subbed_user
    stub_build_server do
      assert_difference("Project.count") do
        post copy_project_url(@project)
      end
    end
    copy = Project.find_by!(title: "Copy of #{@project.title}", user: subbed_user)
    assert_redirected_to edit_project_path(copy)
  end

  test "copy is blocked for basic subscribers" do
    @user.update!(admin: false)
    assert_no_difference("Project.count") do
      post copy_project_url(@project)
    end
    assert_redirected_to projects_path
  end

  test "copy allows subscribed requester to copy another user's project" do
    requester = users(:subscribed)
    other_project = projects(:one)
    sign_out :user
    sign_in requester
    stub_build_server do
      assert_difference("Project.count", 1) do
        post copy_project_url(other_project)
      end
    end
    copied = Project.find_by!(title: "Copy of #{other_project.title}", user: requester)
    assert_redirected_to edit_project_path(copied)
  end

  test "copy duplicates divisions from the source project" do
    subbed_user = users(:subscribed)
    sign_out :user
    sign_in subbed_user
    stub_build_server do
      post copy_project_url(@project)
    end
    copy = Project.find_by!(title: "Copy of #{@project.title}", user: subbed_user)
    assert_equal @project.divisions.count, copy.divisions.count
  end

  test "copy does not create project_assets pointing to another user's library assets" do
    subbed_user = users(:subscribed)
    sign_out :user
    sign_in subbed_user
    stub_build_server do
      post copy_project_url(@project)
    end
    copy = Project.find_by!(title: "Copy of #{@project.title}", user: subbed_user)
    copy.project_assets.each do |a|
      assert_equal a.library_asset.user_id, copy.user_id
    end
  end

  test "copy allows basic requester when source owner is subscribed" do
    owner = users(:subscribed)
    requester = users(:two)
    other_project = projects(:one)
    other_project.update_column(:user_id, owner.id)

    sign_out :user
    sign_in requester

    assert_difference("Project.count", 1) do
      post copy_project_url(other_project)
    end

    copied = Project.find_by!(title: "Copy of #{other_project.title}", user: requester)
    assert_redirected_to edit_project_path(copied)
  end

  test "preview is accessible without authentication" do
    sign_out :user  # sign out
    stub_preview_server do
      post preview_projects_url, params: { source: "<section><title>Test</title></section>", title: "Test" }
    end
    assert_response :success
  end

  test "preview returns build server response body" do
    expected_body = "<html><body><p>Hello World</p></body></html>"
    stub_preview_server(body: expected_body) do
      post preview_projects_url, params: { source: "<section/>", title: "Test" }
    end
    assert_response :success
    assert_includes response.body, "Hello World"
  end

  test "preview prepends a base tag pointing at the owner-only asset redirect" do
    stub_preview_server(body: "<html><body>stub</body></html>") do
      post preview_projects_url, params: { source: "<section/>", title: "Test" }
    end
    assert_response :success
    assert_equal "<base href=\"/preview_assets/\"><html><body>stub</body></html>", response.body
  end

  test "PreTeXt's built-in logo redirects under both the preview and share asset prefixes" do
    sign_out @user
    get "/preview_assets/external/icon.svg"
    assert_redirected_to "/icon-small.svg"

    get "/share_assets/external/icon.svg"
    assert_redirected_to "/icon-small.svg"
  end

  test "preview returns bad_gateway when build server connection fails" do
    stub_preview_server(raise_error: Errno::ECONNREFUSED.new) do
      post preview_projects_url, params: { source: "<section/>", title: "Test" }
    end
    assert_response :bad_gateway
  end

  test "preview returns gateway_timeout when build server times out" do
    stub_preview_server(raise_error: Net::ReadTimeout.new) do
      post preview_projects_url, params: { source: "<section/>", title: "Test" }
    end
    assert_response :gateway_timeout
  end

  test "tryit defaults to latex-style pretext demo" do
    sign_out :user
    get tryit_url

    assert_response :success
    assert_includes response.body, "Demo"
    assert_includes response.body, "data-tryit-target=\"sourceFormatField\""
    assert_includes response.body, "value=\"latex\""
  end

  test "tryit supports markdown demo" do
    sign_out :user
    get tryit_url, params: { demo: "markdown" }

    assert_response :success
    assert_includes response.body, "value=\"markdown\""
    assert_includes response.body, "Try Markdown-style PreTeXt!"
  end

  # --- Docinfo ---

  test "should update docinfo" do
    custom_docinfo = "<docinfo><macros>\\newcommand{\\N}{\\mathbb{N}}</macros></docinfo>"
    patch project_url(@project), params: { project: { docinfo: custom_docinfo } }, as: :json
    assert_response :ok
    assert_equal custom_docinfo, @project.reload.docinfo
  end

  # --- JSON API (used by the javascript editor) ---

  test "should get project as json" do
    get project_url(@project, format: :json)
    assert_response :success
    json = response.parsed_body
    assert_includes json.keys, "title"
    assert_includes json.keys, "pretext_source"
    assert_includes json.keys, "docinfo"
    assert_includes json.keys, "use_common_docinfo"
    assert_includes json.keys, "common_docinfo"
  end

  test "json includes docinfo value" do
    expected_docinfo = "<docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>"
    @project.update_column(:docinfo, expected_docinfo)
    get project_url(@project, format: :json)
    json = response.parsed_body
    assert_equal expected_docinfo, json["docinfo"]
  end

  test "should update project via json" do
    stub_build_server do
      patch project_url(@project),
        params: {
          project: {
            title: "API Title",
            pretext_source: "<pretext><article><section><title>API Title</title></section></article></pretext>",
            docinfo: "<docinfo/>",
            use_common_docinfo: true
          }
        },
        as: :json
    end
    assert_response :success
    json = response.parsed_body
    assert_equal "API Title", json["title"]
    assert_equal "API Title", @project.reload.title
    assert_equal "<docinfo/>", @project.docinfo
    assert_equal true, @project.use_common_docinfo
  end

  test "json includes user common_docinfo and project use_common_docinfo" do
    @project.user.update_column(:common_docinfo, "<docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>")
    @project.update_column(:use_common_docinfo, true)

    get project_url(@project, format: :json)
    json = response.parsed_body

    assert_equal true, json["use_common_docinfo"]
    assert_equal "<docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>", json["common_docinfo"]
  end

  test "JSON update with enqueue_html_source_job param enqueues SetHtmlSourceJob" do
    assert_enqueued_with(job: SetHtmlSourceJob) do
      patch project_url(@project),
        params: { project: { title: @project.title }, enqueue_html_source_job: true },
        as: :json
    end
  end

  test "JSON update with enqueue_html_source_job param sets generating placeholder immediately" do
    patch project_url(@project),
      params: { project: { title: @project.title }, enqueue_html_source_job: true },
      as: :json
    assert_equal "<p>Generating new quick build... (Refresh to update.)</p>", @project.reload.html_source
  end

  test "JSON update without enqueue_html_source_job param does not enqueue SetHtmlSourceJob" do
    assert_no_enqueued_jobs(only: SetHtmlSourceJob) do
      patch project_url(@project),
        params: { project: { title: "API Title" } },
        as: :json
    end
  end

  test "non-owner cannot get project json" do
    other_project = projects(:two)
    get project_url(other_project, format: :json)
    assert_response 403
  end

  test "non-owner cannot update project via json" do
    other_project = projects(:two)
    patch project_url(other_project),
      params: { project: { title: "Stolen" } },
      as: :json
    assert_response 403
    assert_not_equal "Stolen", other_project.reload.title
  end

  test "unauthenticated user cannot get project json" do
    sign_out :user
    get project_url(@project, format: :json)
    assert_response :unauthorized
  end
end
