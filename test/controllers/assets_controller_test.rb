require "test_helper"

class AssetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one)
    sign_in @user
  end

  test "share redirects to the asset's current file URL when signed in as the owner" do
    asset = assets(:image_one)

    get share_asset_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share redirects to the asset's current file URL when signed out entirely" do
    asset = assets(:image_one)

    sign_out @user

    get share_asset_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share redirects to the asset's current file URL for a signed-in non-owner" do
    asset = assets(:image_one)

    sign_out @user
    sign_in users(:two)

    get share_asset_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share_thumbnail redirects to a resized variant URL for the owner" do
    asset = assets(:image_one)

    get share_asset_thumbnail_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share_thumbnail redirects when signed out entirely" do
    asset = assets(:image_one)

    sign_out @user

    get share_asset_thumbnail_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share_thumbnail 404s for an asset with no thumbnailable file" do
    asset = assets(:authored_one)

    get share_asset_thumbnail_project_path(@project, ref: asset.ref)

    assert_response :not_found
  end

  test "file redirects to the asset's current file URL for the owner" do
    asset = assets(:image_one)

    get share_asset_file_path(asset, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "file denies access to another user's asset" do
    asset = assets(:image_one)

    sign_out @user
    # The subscribed user neither owns nor collaborates on this asset's
    # project (user two is now a collaborator via fixtures).
    sign_in users(:subscribed)

    get share_asset_file_path(asset, format: "png")

    # CanCan::AccessDenied is rescued globally (application_controller.rb) into
    # a redirect for non-JSON requests, rather than propagating as an exception.
    assert_redirected_to projects_path
  end

  test "file requires authentication when signed out entirely" do
    asset = assets(:image_one)

    sign_out @user

    get share_asset_file_path(asset, format: "png")

    assert_response :unauthorized
  end

  # --- Generated outputs ---

  def generated_asset_with_outputs
    asset = @project.assets.create!(kind: :generated, generator: "prefigure", ref: "my-graph", title: "Graph", source: "<diagram/>")
    asset.file.attach(io: File.open(Rails.root.join("test/fixtures/files/test_diagram.svg")),
                      filename: "graph.svg", content_type: "image/svg+xml")
    asset.renditions.attach(io: StringIO.new("<diagram/>"), filename: "-annotations.xml", content_type: "application/xml")
    asset.save!
    asset
  end

  test "generated_file redirects to an output by the name a build gives it, signed out too" do
    generated_asset_with_outputs
    sign_out @user

    get generated_file_project_path(@project, generator: "prefigure", filename: "my-graph-annotations.xml")
    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location

    get generated_file_project_path(@project, generator: "prefigure", filename: "my-graph.svg")
    assert_response :redirect
  end

  test "generated_file is 404 for a name no generated asset produces" do
    generated_asset_with_outputs

    get generated_file_project_path(@project, generator: "prefigure", filename: "my-graph.pdf")
    assert_response :not_found
    get generated_file_project_path(@project, generator: "prefigure", filename: "other.svg")
    assert_response :not_found
    get generated_file_project_path(@project, generator: "latex-image", filename: "my-graph.svg")
    assert_response :not_found
  end
end
