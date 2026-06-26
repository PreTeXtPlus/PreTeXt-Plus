require "test_helper"

class AssetFetchesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in @user
  end

  test "create streams back the fetched bytes without persisting anything" do
    SafeUrlFetcher.stub(:call, [ "fake-png-bytes", "image/png" ]) do
      assert_no_difference -> { LibraryAsset.count } do
        post asset_fetches_url, params: { url: "https://example.com/pic.png" }
      end
    end

    assert_response :success
    assert_equal "image/png", response.media_type
    assert_equal "fake-png-bytes", response.body
  end

  test "create reports an error when the fetch is rejected" do
    fetcher = ->(_url) { raise SafeUrlFetcher::UnsafeUrlError, "URL points to a disallowed address" }
    SafeUrlFetcher.stub(:call, fetcher) do
      assert_no_difference -> { LibraryAsset.count } do
        post asset_fetches_url, params: { url: "http://localhost/pic.png" }
      end
    end

    assert_response :unprocessable_entity
    assert_equal "URL points to a disallowed address", response.parsed_body["error"]
  end

  test "create requires a url" do
    post asset_fetches_url, params: {}

    assert_response :unprocessable_entity
  end
end
