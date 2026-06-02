require "test_helper"

class ProjectAssetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project_asset = project_assets(:one)
  end

  test "should get index" do
    get project_assets_url
    assert_response :success
  end

  test "should get new" do
    get new_project_asset_url
    assert_response :success
  end

  test "should create project_asset" do
    assert_difference("ProjectAsset.count") do
      post project_assets_url, params: { project_asset: { library_asset_id: @project_asset.library_asset_id, project_id: @project_asset.project_id } }
    end

    assert_redirected_to project_asset_url(ProjectAsset.last)
  end

  test "should show project_asset" do
    get project_asset_url(@project_asset)
    assert_response :success
  end

  test "should get edit" do
    get edit_project_asset_url(@project_asset)
    assert_response :success
  end

  test "should update project_asset" do
    patch project_asset_url(@project_asset), params: { project_asset: { library_asset_id: @project_asset.library_asset_id, project_id: @project_asset.project_id } }
    assert_redirected_to project_asset_url(@project_asset)
  end

  test "should destroy project_asset" do
    assert_difference("ProjectAsset.count", -1) do
      delete project_asset_url(@project_asset)
    end

    assert_redirected_to project_assets_url
  end
end
