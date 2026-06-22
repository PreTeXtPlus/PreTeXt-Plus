require "test_helper"

class LibraryAssetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in @user
  end

  # A fake Net::HTTP response: `success` controls is_a?(Net::HTTPSuccess).
  def fake_http_response(body:, content_type: "image/png", success: true)
    response = Struct.new(:body, :content_type).new(body, content_type)
    response.define_singleton_method(:is_a?) { |klass| success && klass == Net::HTTPSuccess }
    response
  end

  test "create downloads and attaches a file when given a url" do
    response = fake_http_response(body: "fake-png-bytes")

    Net::HTTP.stub(:get_response, response) do
      assert_difference -> { LibraryAsset.count }, 1 do
        post library_assets_url(format: :json), params: {
          library_asset: { kind: "file", short_description: "Remote", url: "https://example.com/pic.png" }
        }
      end
    end

    assert_response :created
    asset = LibraryAsset.where(user: @user).order(:created_at).last
    assert asset.file.attached?, "expected the downloaded file to be attached"
    assert_equal "pic.png", asset.file.filename.to_s
  end

  test "create reports an error when the url cannot be fetched" do
    response = fake_http_response(body: "not found", content_type: "text/plain", success: false)

    Net::HTTP.stub(:get_response, response) do
      assert_no_difference -> { LibraryAsset.count } do
        post library_assets_url(format: :json), params: {
          library_asset: { kind: "file", short_description: "Bad", url: "https://example.com/missing.png" }
        }
      end
    end

    assert_response :unprocessable_entity
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
