require "test_helper"

class AssetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one)
    sign_in @user
  end

  def asset_with_file
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )
    asset
  end

  test "share redirects to the asset's current file URL when signed in as the owner" do
    asset = asset_with_file

    get share_asset_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share redirects to the asset's current file URL when signed out entirely" do
    asset = asset_with_file

    sign_out @user

    get share_asset_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share redirects to the asset's current file URL for a signed-in non-owner" do
    asset = asset_with_file

    sign_out @user
    sign_in users(:two)

    get share_asset_project_path(@project, ref: asset.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "file redirects to the asset's current file URL for the owner" do
    asset = asset_with_file

    get share_asset_file_path(asset, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "file denies access to another user's asset" do
    asset = asset_with_file

    sign_out @user
    sign_in users(:two)

    get share_asset_file_path(asset, format: "png")

    # CanCan::AccessDenied is rescued globally (application_controller.rb) into
    # a redirect for non-JSON requests, rather than propagating as an exception.
    assert_redirected_to projects_path
  end

  test "file requires authentication when signed out entirely" do
    asset = asset_with_file

    sign_out @user

    get share_asset_file_path(asset, format: "png")

    assert_response :unauthorized
  end
end
