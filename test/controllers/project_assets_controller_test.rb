require "test_helper"

class ProjectAssetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one)
    sign_in @user
  end

  test "create persists a library asset's membership in the project" do
    asset = library_assets(:authored_one)

    assert_difference -> { ProjectAsset.count }, 1 do
      post project_project_assets_url(@project, format: :json), params: {
        project_asset: { library_asset_id: asset.id, ref: "intro-activity" }
      }
    end

    assert_response :created
    membership = ProjectAsset.order(:created_at).last
    assert_equal @project, membership.project
    assert_equal asset, membership.library_asset
    assert_equal "intro-activity", membership.ref

    body = JSON.parse(response.body)
    assert_equal "intro-activity", body["ref"]
    assert_equal asset.id, body["library_asset"]["id"]
  end

  test "create rejects a ref already used by another asset in the project" do
    asset = library_assets(:authored_one)

    assert_no_difference -> { ProjectAsset.count } do
      post project_project_assets_url(@project, format: :json), params: {
        project_asset: { library_asset_id: asset.id, ref: project_assets(:one).ref }
      }
    end

    assert_response :unprocessable_entity
  end

  test "create rejects a ref already used by a division in the project" do
    asset = library_assets(:authored_one)

    assert_no_difference -> { ProjectAsset.count } do
      post project_project_assets_url(@project, format: :json), params: {
        project_asset: { library_asset_id: asset.id, ref: divisions(:one).ref }
      }
    end

    assert_response :unprocessable_entity
  end

  test "create refuses to act on a project the user does not own" do
    other_project = projects(:two)

    assert_no_difference -> { ProjectAsset.count } do
      post project_project_assets_url(other_project, format: :json), params: {
        project_asset: { library_asset_id: library_assets(:authored_one).id, ref: "intro" }
      }
    end

    assert_response :not_found
  end

  test "destroy removes only the membership, keyed by library asset id" do
    membership = project_assets(:one)

    assert_difference -> { ProjectAsset.count }, -1 do
      assert_no_difference -> { LibraryAsset.count } do
        delete project_project_asset_url(@project, membership.library_asset_id, format: :json)
      end
    end

    assert_response :no_content
    assert LibraryAsset.exists?(membership.library_asset_id)
  end

  test "destroy returns not found when the asset is not in the project" do
    delete project_project_asset_url(@project, library_assets(:authored_one).id, format: :json)
    assert_response :not_found
  end

  test "destroy refuses to act on a project the user does not own" do
    other_project = projects(:two)

    assert_no_difference -> { ProjectAsset.count } do
      delete project_project_asset_url(other_project, project_assets(:one).library_asset_id, format: :json)
    end

    assert_response :not_found
  end

  def create_project_asset_with_file(ref:)
    upload = fixture_file_upload("test_image.png", "image/png")
    post library_assets_url(format: :json), params: {
      library_asset: { kind: "file", short_description: "test_image.png", file: upload }
    }
    library_asset = LibraryAsset.where(user: @user).order(:created_at).last

    post project_project_assets_url(@project, format: :json), params: {
      project_asset: { library_asset_id: library_asset.id, ref: ref }
    }
    @project.project_assets.find_by!(ref: ref)
  end

  test "preview_file redirects to the asset's current file URL" do
    membership = create_project_asset_with_file(ref: "diagram-two")

    get share_asset_project_path(@project, ref: membership.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share_file redirects to the asset's current file URL when signed out entirely" do
    membership = create_project_asset_with_file(ref: "diagram-two")

    sign_out @user

    get share_asset_project_path(@project, ref: membership.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "share_file redirects to the asset's current file URL for a signed-in non-owner" do
    membership = create_project_asset_with_file(ref: "diagram-two")

    sign_out @user
    sign_in users(:two)

    get share_asset_project_path(@project, ref: membership.ref, format: "png")

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end
end
