require "test_helper"

class LibraryAssetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @library_asset = library_assets(:one)
  end

  test "should get index" do
    get library_assets_url
    assert_response :success
  end

  test "should get new" do
    get new_library_asset_url
    assert_response :success
  end

  test "should create library_asset" do
    assert_difference("LibraryAsset.count") do
      post library_assets_url, params: { library_asset: { filename: @library_asset.filename, user_id: @library_asset.user_id } }
    end

    assert_redirected_to library_asset_url(LibraryAsset.last)
  end

  test "should show library_asset" do
    get library_asset_url(@library_asset)
    assert_response :success
  end

  test "should get edit" do
    get edit_library_asset_url(@library_asset)
    assert_response :success
  end

  test "should update library_asset" do
    patch library_asset_url(@library_asset), params: { library_asset: { filename: @library_asset.filename, user_id: @library_asset.user_id } }
    assert_redirected_to library_asset_url(@library_asset)
  end

  test "should destroy library_asset" do
    assert_difference("LibraryAsset.count", -1) do
      delete library_asset_url(@library_asset)
    end

    assert_redirected_to library_assets_url
  end
end
