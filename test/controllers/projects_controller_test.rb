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

  test "update creates a file-backed asset via a multipart assets_attributes upload" do
    upload = fixture_file_upload("test_image.png", "image/png")

    # A new asset is created by omitting `id` (Rails' nested attributes treat an
    # id-less entry as a fresh row and mint the UUID); the client matches it back
    # out of the response by its project-unique `ref`, exactly as onAssetUpload does.
    assert_difference("@project.assets.count", 1) do
      patch project_url(@project, format: :json), params: {
        project: { assets_attributes: [ { ref: "diagram-two", kind: "file", title: "Diagram Two", file: upload } ] }
      }
    end

    assert_response :success
    asset = @project.assets.find_by!(ref: "diagram-two")
    assert asset.file_kind?
    assert asset.file.attached?
    assert_equal "test_image.png", asset.file.filename.to_s

    body = response.parsed_body
    asset_json = body["assets"].find { |a| a["ref"] == "diagram-two" }
    assert_equal asset.id, asset_json["id"]
    assert_equal share_asset_project_path(@project, ref: "diagram-two", format: "png"), asset_json["path"]
    assert_equal "png", asset_json["extension"]
  end

  # --- Divisions (nested attributes; the /divisions endpoint was removed) ---

  test "update creates a non-root division via an id-less divisions_attributes entry" do
    assert_difference("@project.divisions.count", 1) do
      patch project_url(@project),
        params: { project: { divisions_attributes: [ { ref: "newly-added", source_format: "pretext", source: "<section><title>New</title></section>" } ] } },
        as: :json
    end

    assert_response :success
    division = @project.divisions.find_by!(ref: "newly-added")
    # A division added this way must never become a second root.
    assert_not division.is_root?
    assert_equal "<section><title>New</title></section>", division.source

    # The client matches the new row back out of the response by its ref, so the
    # response must carry it with its freshly minted id.
    division_json = response.parsed_body["divisions"].find { |d| d["ref"] == "newly-added" }
    assert_equal division.id, division_json["id"]
  end

  test "creating a division leaves the existing root untouched" do
    root = @project.root_division
    patch project_url(@project),
      params: { project: { divisions_attributes: [ { ref: "sibling", source_format: "pretext", source: "<section/>" } ] } },
      as: :json
    assert_response :success
    assert_equal root.id, @project.reload.root_division.id
    assert_equal 1, @project.divisions.where(is_root: true).count
  end

  test "update edits an existing division via its id without creating a row" do
    division = divisions(:one)
    assert_no_difference("@project.divisions.count") do
      patch project_url(@project),
        params: { project: { divisions_attributes: [ { id: division.id, source: "<section><title>Edited</title></section>" } ] } },
        as: :json
    end
    assert_response :success
    assert_equal "<section><title>Edited</title></section>", division.reload.source
  end

  test "update destroys a division via _destroy" do
    division = @project.divisions.create!(ref: "to-remove", source_format: "pretext", source: "<section/>")
    assert_difference("@project.divisions.count", -1) do
      patch project_url(@project),
        params: { project: { divisions_attributes: [ { id: division.id, _destroy: true } ] } },
        as: :json
    end
    assert_response :success
    assert_not Division.exists?(division.id)
  end

  test "update rejects a division whose ref collides with an asset" do
    asset_ref = assets(:authored_one).ref
    assert_no_difference("@project.divisions.count") do
      patch project_url(@project),
        params: { project: { divisions_attributes: [ { ref: asset_ref, source_format: "pretext", source: "<section/>" } ] } },
        as: :json
    end
    assert_response :unprocessable_entity
  end

  test "non-owner cannot add a division to another user's project" do
    other_project = projects(:two)
    assert_no_difference("other_project.divisions.count") do
      patch project_url(other_project),
        params: { project: { divisions_attributes: [ { ref: "sneaky", source_format: "pretext", source: "<section/>" } ] } },
        as: :json
    end
    assert_response 403
  end

  test "update creates an authored asset via a JSON assets_attributes entry" do
    assert_difference("@project.assets.count", 1) do
      patch project_url(@project),
        params: { project: { assets_attributes: [ { ref: "new-activity", kind: "authored", title: "New Activity", source: "<p>hi</p>" } ] } },
        as: :json
    end

    assert_response :success
    asset = @project.assets.find_by!(ref: "new-activity")
    assert asset.authored_kind?
    assert_equal "<p>hi</p>", asset.source
    assert_not asset.file.attached?

    asset_json = response.parsed_body["assets"].find { |a| a["ref"] == "new-activity" }
    assert_equal asset.id, asset_json["id"]
    assert_nil asset_json["path"]
  end

  test "update edits an existing asset's source via its id" do
    asset = assets(:authored_one)
    patch project_url(@project),
      params: { project: { assets_attributes: [ { id: asset.id, source: "<p>edited</p>" } ] } },
      as: :json

    assert_response :success
    assert_equal "<p>edited</p>", asset.reload.source
    # An id-scoped edit must not create or drop rows.
    assert_equal 1, @project.assets.where(ref: asset.ref).count
  end

  test "update destroys an asset via _destroy" do
    asset = assets(:authored_one)
    assert_difference("@project.assets.count", -1) do
      patch project_url(@project),
        params: { project: { assets_attributes: [ { id: asset.id, _destroy: true } ] } },
        as: :json
    end

    assert_response :success
    assert_not Asset.exists?(asset.id)
  end

  test "update rejects an asset whose ref collides with a division" do
    root_ref = @project.root_division.ref
    assert_no_difference("@project.assets.count") do
      patch project_url(@project),
        params: { project: { assets_attributes: [ { ref: root_ref, kind: "authored", title: "Clash" } ] } },
        as: :json
    end
    assert_response :unprocessable_entity
  end

  test "non-owner cannot add an asset to another user's project" do
    other_project = projects(:two)
    assert_no_difference("other_project.assets.count") do
      patch project_url(other_project),
        params: { project: { assets_attributes: [ { ref: "sneaky", kind: "authored", title: "Sneaky" } ] } },
        as: :json
    end
    assert_response 403
  end

  test "project json exposes assets in the shape the editor reads" do
    get project_url(@project, format: :json)
    assert_response :success

    assets_json = response.parsed_body["assets"]
    assert_kind_of Array, assets_json

    authored = assets_json.find { |a| a["ref"] == "my-activity" }
    assert_equal assets(:authored_one).id, authored["id"]
    assert_equal "authored", authored["kind"]
    # A source-only asset carries no file redirect/extension.
    assert_nil authored["path"]
    assert_nil authored["extension"]
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

  test "copy_redirect sends GET requests to the share/source page" do
    sign_out :user
    get share_copy_project_url(@project)
    assert_redirected_to share_source_project_url(@project)
  end

  test "copy_redirect is accessible with and without authentication" do
    get share_copy_project_url(@project)
    assert_response :redirect
    sign_out :user
    get share_copy_project_url(@project)
    assert_response :redirect
  end

  test "copy_redirect does not create a project or require an existing project" do
    sign_out :user
    assert_no_difference("Project.count") do
      get "/projects/does-not-exist/share/copy"
    end
    assert_redirected_to "/projects/does-not-exist/share/source"
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

  test "copy gives the duplicated project its own independent assets" do
    subbed_user = users(:subscribed)
    sign_out :user
    sign_in subbed_user
    stub_build_server do
      post copy_project_url(@project)
    end
    copy = Project.find_by!(title: "Copy of #{@project.title}", user: subbed_user)
    assert_equal @project.assets.count, copy.assets.count
    copy.assets.each do |copied_asset|
      original_asset = @project.assets.find_by!(ref: copied_asset.ref)
      assert_not_equal original_asset.id, copied_asset.id
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
      post preview_project_url(@project), params: { source: "<section><title>Test</title></section>", title: "Test" }
    end
    assert_response :success
  end

  test "preview returns build server response body" do
    expected_body = "<html><body><p>Hello World</p></body></html>"
    stub_preview_server(body: expected_body) do
      post preview_project_url(@project), params: { source: "<section/>", title: "Test" }
    end
    assert_response :success
    assert_includes response.body, "Hello World"
  end

  test "preview with no project_id renders the build server response with no base tag" do
    stub_preview_server(body: "<html><body>stub</body></html>") do
      post preview_project_url(@project), params: { source: "<section/>", title: "Test" }
    end
    assert_response :success
    assert_equal "<html><body>stub</body></html>", response.body
  end

  test "PreTeXt's built-in logo redirects under both the preview and share asset prefixes" do
    get "/projects/#{@project.id}/preview/external/icon.svg"
    assert_redirected_to "/icon-small.png"

    sign_out @user
    get "/projects/#{@project.id}/share/external/icon.svg"
    assert_redirected_to "/icon-small.png"
  end

  test "preview returns bad_gateway when build server connection fails" do
    stub_preview_server(raise_error: Errno::ECONNREFUSED.new) do
      post preview_project_url(@project), params: { source: "<section/>", title: "Test" }
    end
    assert_response :bad_gateway
  end

  test "preview returns gateway_timeout when build server times out" do
    stub_preview_server(raise_error: Net::ReadTimeout.new) do
      post preview_project_url(@project), params: { source: "<section/>", title: "Test" }
    end
    assert_response :gateway_timeout
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
    assert_equal Project::ENQUEUE_SOURCE_PLACEHOLDER, @project.reload.html_source
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

  # --- Templates ---

  test "index lists the current user's template projects, badged as templates" do
    Project.create!(user: @user, title: "A Uniquely Named Template", is_template: true)
    get projects_url
    assert_response :success
    # A template stays in its owner's list so they can still edit it...
    assert_includes response.body, "A Uniquely Named Template"
    # ...but is clearly marked, so they know edits affect what new users start from.
    assert_includes response.body, "Template"
    assert_includes response.body, "Edit with care"
  end

  test "create_from_template duplicates a flagged template into the current user's account" do
    template = projects(:two)
    template.update!(is_template: true, title: "Calc Template")

    stub_build_server do
      assert_difference("Project.count", 1) do
        post create_from_template_projects_url(template_id: template.id)
      end
    end

    copy = Project.find_by!(title: "Calc Template", user: @user)
    assert_not copy.is_template?
    assert_equal template.divisions.count, copy.divisions.count
    assert_redirected_to edit_project_url(copy)
  end

  test "a failed empty-document create still renders the chooser with its template list" do
    # An invalid division (blank ref) forces the validation re-render path, which
    # must still set @templates so the template dialog renders without error.
    assert_no_difference("Project.count") do
      post projects_url, params: {
        project: { title: "X", divisions_attributes: { "0" => { is_root: "true", ref: "", source_format: "pretext" } } }
      }
    end
    assert_response :unprocessable_entity
    assert_includes response.body, "Start project from template"
  end

  test "create_from_template refuses a project that is not a template" do
    non_template = projects(:two)
    assert_no_difference("Project.count") do
      post create_from_template_projects_url(template_id: non_template.id)
    end
    assert_response :not_found
  end

  # --- Import ---

  test "create_from_import builds a project from the import payload posted as json" do
    bytes = file_fixture("test_image.png").binread

    assert_difference("Project.count", 1) do
      post create_from_import_projects_url,
        params: {
          project: {
            title: "Imported Book",
            docinfo: "<docinfo/>",
            document_type: "article",
            divisions_attributes: [
              { ref: "document", source_format: "pretext", source: "<article><title>Imported</title></article>", is_root: true }
            ],
            assets_attributes: [
              { ref: "fig-one", kind: "file", title: "fig.png", short_description: "fig.png",
                file: { filename: "fig.png", content_type: "image/png", data: Base64.strict_encode64(bytes) } }
            ]
          }
        },
        as: :json
    end

    assert_response :created
    project = Project.find_by!(title: "Imported Book", user: @user)
    assert project.root_division.present?
    assert_equal "<docinfo/>", project.docinfo

    asset = project.assets.sole
    assert asset.file.attached?
    assert_equal "fig.png", asset.file.filename.to_s
    assert_equal "image/png", asset.file.content_type
    # The base64 round-trip must reproduce the original bytes exactly.
    assert_equal bytes, asset.file.download

    assert_equal edit_project_path(project), response.parsed_body["project_url"]
  end

  test "create_from_import handles a multi-division book payload" do
    # Shape produced by @pretextbook/import for a LaTeX book: a root division
    # holding <plus:chapter ref="..."/> placeholders plus one row per chapter.
    assert_difference("Project.count", 1) do
      post create_from_import_projects_url,
        params: {
          project: {
            title: "A Real Book",
            docinfo: "",
            document_type: "book",
            divisions_attributes: [
              { ref: "document", source_format: "pretext", is_root: true,
                source: %(<book xml:id="document"><title>A Real Book</title><plus:chapter ref="ch-01"/><plus:chapter ref="ch-02"/></book>) },
              { ref: "ch-01", source_format: "pretext", is_root: false,
                source: %(<chapter xml:id="ch-01"><title>Alpha</title></chapter>) },
              { ref: "ch-02", source_format: "pretext", is_root: false,
                source: %(<chapter xml:id="ch-02"><title>Beta</title></chapter>) }
            ],
            assets_attributes: []
          }
        },
        as: :json
    end

    assert_response :created
    project = Project.find_by!(title: "A Real Book", user: @user)
    assert project.book_document_type?
    assert_equal 3, project.divisions.count
    assert_equal 1, project.divisions.where(is_root: true).count
    assert_equal "document", project.root_division.ref
    assert_equal %w[ch-01 ch-02], project.divisions.where(is_root: false).order(:ref).pluck(:ref)
    # An empty docinfo from the importer falls back to the app default.
    assert_equal Project.default_docinfo, project.docinfo
  end

  test "create_from_import requires authentication" do
    sign_out :user
    assert_no_difference("Project.count") do
      post create_from_import_projects_url, params: { project: { title: "Nope" } }
    end
    assert_redirected_to new_user_session_path
  end
end
