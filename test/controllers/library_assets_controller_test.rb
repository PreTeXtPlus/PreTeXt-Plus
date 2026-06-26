require "test_helper"

class LibraryAssetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in @user
  end

  test "create persists a directly uploaded file (the editor's upload path)" do
    upload = fixture_file_upload("test_image.png", "image/png")

    assert_difference -> { LibraryAsset.count }, 1 do
      post library_assets_url(format: :json), params: {
        library_asset: { kind: "file", short_description: "test_image.png", file: upload }
      }
    end

    assert_response :created
    asset = LibraryAsset.where(user: @user).order(:created_at).last
    assert asset.file.attached?, "expected the uploaded file to be attached"
    assert_equal "test_image.png", asset.file.filename.to_s
    assert_equal "image/png", asset.file.content_type
  end

  test "create without a url saves a plain library asset" do
    assert_difference -> { LibraryAsset.count }, 1 do
      post library_assets_url(format: :json), params: {
        library_asset: { kind: "authored", short_description: "My Activity", content: "" }
      }
    end

    assert_response :created
    assert_equal "authored", LibraryAsset.where(user: @user).order(:created_at).last.kind
  end

  test "show exposes the owner-only preview path and the file's extension" do
    upload = fixture_file_upload("test_image.png", "image/png")
    post library_assets_url(format: :json), params: {
      library_asset: { kind: "file", short_description: "test_image.png", file: upload }
    }
    asset = LibraryAsset.where(user: @user).order(:created_at).last

    get library_asset_url(asset, format: :json)

    body = JSON.parse(response.body)
    assert_equal preview_asset_file_path(asset, format: "png"), body["file"]
    assert_equal "png", body["extension"]
  end

  test "preview_file redirects to the asset's current file URL" do
    upload = fixture_file_upload("test_image.png", "image/png")
    post library_assets_url(format: :json), params: {
      library_asset: { kind: "file", short_description: "test_image.png", file: upload }
    }
    asset = LibraryAsset.where(user: @user).order(:created_at).last

    get preview_asset_file_path(asset, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "preview_file denies access to another user's asset" do
    upload = fixture_file_upload("test_image.png", "image/png")
    post library_assets_url(format: :json), params: {
      library_asset: { kind: "file", short_description: "test_image.png", file: upload }
    }
    asset = LibraryAsset.where(user: @user).order(:created_at).last

    sign_out @user
    sign_in users(:two)

    get preview_asset_file_path(asset, format: "png")

    # CanCan::AccessDenied is rescued globally (application_controller.rb) into
    # a redirect for non-JSON requests, rather than propagating as an exception.
    assert_redirected_to projects_path
  end

  test "share_file redirects to the asset's current file URL for a signed-in non-owner" do
    upload = fixture_file_upload("test_image.png", "image/png")
    post library_assets_url(format: :json), params: {
      library_asset: { kind: "file", short_description: "test_image.png", file: upload }
    }
    asset = LibraryAsset.where(user: @user).order(:created_at).last

    sign_out @user
    sign_in users(:two)

    get share_asset_file_path(asset, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share_file redirects to the asset's current file URL when signed out entirely" do
    upload = fixture_file_upload("test_image.png", "image/png")
    post library_assets_url(format: :json), params: {
      library_asset: { kind: "file", short_description: "test_image.png", file: upload }
    }
    asset = LibraryAsset.where(user: @user).order(:created_at).last

    sign_out @user

    get share_asset_file_path(asset, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end
end
