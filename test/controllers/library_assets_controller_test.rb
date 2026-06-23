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
        library_asset: { kind: "doenet", short_description: "My Activity", content: "" }
      }
    end

    assert_response :created
    assert_equal "doenet", LibraryAsset.where(user: @user).order(:created_at).last.kind
  end
end
