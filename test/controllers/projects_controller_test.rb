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

  test "should get owned" do
    get owned_projects_url
    assert_response :success
  end

  test "should get shared" do
    get shared_projects_url
    assert_response :success
  end

  test "index has no show-more link when 5 or fewer owned projects exist" do
    get projects_url
    assert_response :success
    assert_select "a[href=?]", owned_projects_path, count: 0
  end

  test "index shows a show-more link once there are 6 or more owned projects" do
    4.times { |n| Project.create!(user: @user, title: "Extra Owned #{n}") }
    get projects_url
    assert_response :success
    assert_select "a[href=?]", owned_projects_path
  end

  test "index has no show-more link when 5 or fewer shared projects exist" do
    sign_out :user
    sign_in users(:two)
    get projects_url
    assert_response :success
    assert_select "a[href=?]", shared_projects_path, count: 0
  end

  test "index shows a show-more link once there are 6 or more shared projects" do
    sign_out :user
    sign_in users(:two)
    5.times do |n|
      project = Project.create!(user: @user, title: "Extra Shared #{n}")
      project.collaborations.create!(user: users(:two), invited_email: users(:two).email, accepted_at: Time.current)
    end
    get projects_url
    assert_response :success
    assert_select "a[href=?]", shared_projects_path
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

  test "show has no legacy quick-preview notice when html_source was never set" do
    get project_url(@project)
    assert_response :success
    assert_select "a[href=?]", share_project_path(@project), count: 0
  end

  test "show has a legacy quick-preview notice when html_source is present" do
    @project.update_column(:html_source, "<h1>quick build</h1>")

    get project_url(@project)

    assert_response :success
    assert_select "a[href=?]", share_project_path(@project)
  end

  # one_instructor and one_print have never been built. Build all is a subscriber
  # feature (see Ability#build_all), so a subscribed owner sees the button...
  test "show offers Build all when the owner is subscribed and a target has never been built" do
    subscription_seats(:one).update!(user: @user)

    get project_url(@project)

    assert_response :success
    assert_match "Build all", response.body
  end

  # ...and an unsubscribed owner sees a Subscribe upsell in its place instead.
  test "show offers a Subscribe upsell instead of Build all when the owner is not subscribed" do
    get project_url(@project)

    assert_response :success
    assert_no_match "Build all", response.body
    assert_match "Subscribe", response.body
  end

  test "show has no bulk button when every target already needs individual attention" do
    sign_in users(:two) # two_web's only build failed -- neither never nor stale

    get project_url(projects(:two))

    assert_response :success
    assert_no_match "Build all", response.body
    assert_no_match "Rebuild outdated", response.body
  end

  test "show carries a Shared pill for a collaborator, not for the owner" do
    get project_url(@project)
    assert_response :success
    assert_no_match "Shared", response.body

    sign_in users(:two) # accepted collaborator on @project (see collaborations.yml)
    get project_url(@project)

    assert_response :success
    assert_match "Shared", response.body
  end

  test "a collaborator sees nothing once the project is at its target quota" do
    (@user.target_quota - @project.targets.count).times { |i| @project.targets.create!(name: "Extra #{i}", kind: "website") }

    sign_in users(:two) # accepted collaborator on @project
    get project_url(@project)

    assert_response :success
    assert_no_match "reached", response.body
    assert_no_match "+ Add an output", response.body
  end

  test "should get edit" do
    get edit_project_url(@project)
    assert_response :success
  end

  # ---- download ----
  #
  # The escape hatch: someone choosing where to keep years of writing should be able to
  # leave with a zip that opens in PreTeXt-CLI.

  test "download returns a PreTeXt-CLI project zip" do
    get download_project_url(@project)

    assert_response :success
    assert_equal "application/zip", response.media_type

    entries = {}
    Zip::File.open_buffer(StringIO.new(response.body)) do |zip|
      zip.each { |e| entries[e.name] = e.get_input_stream.read if e.file? }
    end

    assert_includes entries.keys, "project.ptx"
    assert_includes entries.keys, "publication/publication.ptx"
    assert_includes entries.keys, "source/main.ptx"
  end

  test "cannot download another user's project" do
    sign_out :user
    # Not users(:two): they collaborate on this project (see collaborations.yml)
    # and so can legitimately download it. This needs someone with no access at all.
    sign_in users(:subscribed)

    get download_project_url(@project)

    assert_redirected_to projects_path
  end

  test "a collaborator can download the project they share" do
    sign_out :user
    sign_in users(:two)

    get download_project_url(@project)

    assert_response :success
  end

  # ---- legacy share links ----
  #
  # These URLs are already in the world, possibly printed in syllabi, so they stay
  # working whether or not the project has a published output.

  test "share still serves the quick build when nothing is published, from the published origin" do
    @project.update_column(:html_source, "<h1>quick build</h1>")

    get share_project_url(@project)

    # The quick build is user HTML too, so even the fallback moves off the session
    # origin: the link keeps working, but what it serves renders on pub.
    assert_redirected_to share_project_url(@project, host: "pub.example.com")
    follow_redirect!

    assert_response :success
    assert_match "quick build", response.body
  end

  test "share redirects to the published output once there is one" do
    target = @project.targets.first
    build = target.builds.create!
    build.mark!(:success)
    build.build_files.create!(relative_path: "index.html")
      .blob.attach(io: StringIO.new("<h1>published</h1>"), filename: "index.html", content_type: "text/html")
    target.update!(published: true)

    get share_project_url(@project)

    # Absolute, and on the published origin: this redirect is how legacy same-origin
    # share links stop serving user content from the origin that holds sessions.
    assert_redirected_to published_url(@project, target.slug, host: "pub.example.com")
    assert_response :found, "a 301 would still be followed after unpublishing"

    # Follow it all the way through: the old assertion stopped at the redirect, which
    # hid that it pointed at target.name where the route wants target.slug.
    follow_redirect! # to the published origin
    follow_redirect! # to index.html, one level inside the target
    assert_response :success
    assert_match "published", response.body
  end

  test "share falls back to the quick build again after unpublishing" do
    target = @project.targets.first
    target.builds.create!.mark!(:success)
    target.update!(published: true)
    target.update!(published: false)
    @project.update_column(:html_source, "<h1>quick build</h1>")

    get share_project_url(@project)
    follow_redirect! # to the published origin

    assert_response :success
    assert_match "quick build", response.body
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
    assert_equal "image/png", asset_json["content_type"]
    assert_equal share_asset_thumbnail_project_path(@project, ref: "diagram-two", format: "png"),
      asset_json["thumbnail_path"]
  end

  # --- Visibility ---

  test "update changes project visibility via a plain HTML form post" do
    assert @project.private_visibility?
    patch project_url(@project), params: { project: { visibility: "public" } }
    assert_redirected_to project_url(@project)
    assert @project.reload.public_visibility?
  end

  test "non-owner cannot change another user's project visibility" do
    other_project = projects(:two)
    patch project_url(other_project), params: { project: { visibility: "public" } }
    assert_redirected_to projects_path
    assert other_project.reload.private_visibility?
  end

  test "collaborator can update the project but not its visibility" do
    sign_out :user
    sign_in users(:two) # accepted collaborator on @project
    assert @project.private_visibility?

    patch project_url(@project), params: { project: { title: "Edited by collaborator", visibility: "public" } }

    assert_redirected_to project_url(@project)
    @project.reload
    assert_equal "Edited by collaborator", @project.title
    assert @project.private_visibility?
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

  # The collaborative editor mints its own uuids and sends the division under
  # one, so a create no longer waits on this request to learn an id.
  test "update creates a division under a client-minted id" do
    id = SecureRandom.uuid
    assert_difference("@project.divisions.count", 1) do
      patch project_url(@project),
        params: { project: { divisions_attributes: [ { id: id, ref: "minted", source_format: "pretext", source: "<section/>" } ] } },
        as: :json
    end
    assert_response :success
    assert_equal "minted", @project.divisions.find(id).ref
  end

  # A removal is re-sent from the shared doc's tombstones until it sticks, so
  # the second attempt must not fail the whole save.
  test "update tolerates a _destroy for a division that is already gone" do
    division = @project.divisions.create!(ref: "twice-removed", source_format: "pretext", source: "<section/>")
    2.times do
      patch project_url(@project),
        params: { project: { divisions_attributes: [ { id: division.id, _destroy: true } ] } },
        as: :json
      assert_response :success
    end
    assert_not Division.exists?(division.id)
  end

  # Tolerating unknown ids means an id belonging to *another* project reaches
  # the database as a primary-key conflict. It cannot touch that row, but it
  # must not surface as a 500 either.
  test "update refuses a nested id that belongs to another project" do
    foreign = divisions(:two)
    assert_no_difference("@project.divisions.count") do
      patch project_url(@project),
        params: { project: { divisions_attributes: [ { id: foreign.id, ref: "stolen", source_format: "pretext", source: "<section/>" } ] } },
        as: :json
    end
    assert_response :unprocessable_entity
    assert_equal "document", foreign.reload.ref
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
    follow_redirect! # to the published origin
    assert_response :success
  end

  # ---- read-only source view (share/source) ----

  test "source is viewable by a signed-in non-owner on an unlisted project" do
    @project.update!(visibility: :unlisted)
    sign_out :user
    sign_in users(:subscribed)
    get share_source_project_url(@project)
    assert_response :success
  end

  test "source is viewable by a signed-in non-owner on a public project" do
    @project.update!(visibility: :public)
    sign_out :user
    sign_in users(:subscribed)
    get share_source_project_url(@project)
    assert_response :success
  end

  test "source is denied for a signed-in non-owner on a private project" do
    assert @project.private_visibility?
    sign_out :user
    sign_in users(:subscribed)
    get share_source_project_url(@project)
    assert_redirected_to projects_path
    assert flash[:alert].present?
  end

  test "source is allowed for an anonymous visitor for a non-private project" do
    @project.update!(visibility: :public)
    sign_out :user
    get share_source_project_url(@project)
    assert_response :success
  end

  test "source.json returns the project's title and divisions for a signed-in non-owner on a public project" do
    @project.update!(visibility: :public)
    sign_out :user
    sign_in users(:subscribed)
    get share_source_project_url(@project, format: :json)
    assert_response :success
    json = JSON.parse(response.body)
    assert_equal @project.title, json["title"]
    assert_equal @project.divisions.count, json["divisions"].size
  end

  test "source.json is denied for a signed-in non-owner on a private project" do
    assert @project.private_visibility?
    sign_out :user
    sign_in users(:subscribed)
    get share_source_project_url(@project, format: :json)
    assert_response :forbidden
    json = JSON.parse(response.body)
    assert json["errors"].present?
  end

  # --- Preview frame ---

  test "preview_frame returns the shim for the owner" do
    get preview_frame_project_path(@project)

    assert_response :success
    assert_equal File.read(Rails.public_path.join("preview-frame.html")), response.body
  end

  test "preview_frame returns the shim for a signed-in collaborator" do
    # projects(:one) already has users(:two) as an accepted collaborator (see
    # test/fixtures/collaborations.yml).
    sign_out @user
    sign_in users(:two)

    get preview_frame_project_path(@project)

    assert_response :success
  end

  test "preview_frame requires authentication when signed out" do
    sign_out @user

    get preview_frame_project_path(@project)

    assert_redirected_to new_user_session_path
  end

  test "preview_frame 404s for a nonexistent project" do
    get preview_frame_project_path(id: SecureRandom.uuid)

    assert_response :not_found
  end

  test "copy creates a duplicate for subscriber" do
    subbed_user = users(:subscribed)
    @project.update!(visibility: :public) # copy now requires the source to be non-private
    sign_out :user
    sign_in subbed_user
    stub_build_server do
      assert_difference("Project.count") do
        post copy_project_url(@project)
      end
    end
    copy = Project.find_by!(title: "Copy of #{@project.title}", user: subbed_user)
    assert_redirected_to project_path(copy)
  end

  test "copy allows subscribed requester to copy another user's project" do
    requester = users(:subscribed)
    other_project = projects(:one)
    other_project.update!(visibility: :public) # copy now requires the source to be non-private
    sign_out :user
    sign_in requester
    stub_build_server do
      assert_difference("Project.count", 1) do
        post copy_project_url(other_project)
      end
    end
    copied = Project.find_by!(title: "Copy of #{other_project.title}", user: requester)
    assert_redirected_to project_path(copied)
  end

  test "copy duplicates divisions from the source project" do
    subbed_user = users(:subscribed)
    @project.update!(visibility: :public) # copy now requires the source to be non-private
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
    @project.update!(visibility: :public) # copy now requires the source to be non-private
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
    other_project.update!(visibility: :public) # copy now requires the source to be non-private

    sign_out :user
    sign_in requester

    assert_difference("Project.count", 1) do
      post copy_project_url(other_project)
    end

    copied = Project.find_by!(title: "Copy of #{other_project.title}", user: requester)
    assert_redirected_to project_path(copied)
  end

  test "copy fails gracefully (not a 500) when it would exceed the requester's asset quota" do
    requester = users(:two)
    own_project = projects(:two) # requester's own project, padded up to their quota
    remaining = requester.asset_quota - requester.assets.count
    remaining.times { |n| own_project.assets.create!(ref: "pad-#{n}", kind: :authored, title: "Pad #{n}") }
    @project.update!(visibility: :public) # copy now requires the source to be non-private

    sign_out :user
    sign_in requester

    assert_no_difference("Project.count") do
      post copy_project_url(@project) # projects(:one), carries 2 assets to copy in
    end

    assert_redirected_to projects_path
    assert_match(/asset limit/i, flash[:alert])
  end

  test "copy is denied for a signed-in non-owner, non-collaborator on a private project" do
    assert @project.private_visibility?
    sign_out :user
    sign_in users(:subscribed)

    assert_no_difference("Project.count") do
      post copy_project_url(@project)
    end

    assert_redirected_to projects_path
    assert flash[:alert].present?
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
    assert_redirected_to "/icon.svg"

    sign_out @user
    get "/projects/#{@project.id}/share/external/icon.svg"
    assert_redirected_to "/icon.svg"
  end

  test "a project's own icon asset is served instead of PreTeXt's built-in logo" do
    icon = @project.assets.create!(ref: "icon", kind: :file, title: "My Icon")
    icon.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png", content_type: "image/png"
    )

    get "/projects/#{@project.id}/share/external/icon.svg"

    assert_response :redirect
    assert_no_match %r{/icon\.svg\z}, response.location
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "an icon asset row with no file attached still falls back to PreTeXt's built-in logo" do
    @project.assets.create!(ref: "icon", kind: :authored, title: "No File", source: "")

    get "/projects/#{@project.id}/share/external/icon.svg"

    assert_redirected_to "/icon.svg"
  end

  # The id-less "Try it!" flow has no persisted Project to query an icon asset
  # against, so this is a bare route-level redirect (config/routes.rb) rather
  # than going through AssetsController#share at all.
  test "the tryit flow's built-in logo redirects under both the bare and tryit-prefixed paths" do
    get "/external/icon"
    assert_redirected_to "/icon.svg"

    get "/tryit/external/icon"
    assert_redirected_to "/icon.svg"
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
    template = projects(:template)

    stub_build_server do
      assert_difference("Project.count", 1) do
        post create_from_template_projects_url(template_id: template.id)
      end
    end

    copy = Project.find_by!(title: "Calc Template (generated from template)", user: @user)
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
