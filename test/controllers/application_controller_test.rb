require "test_helper"

# Unit coverage for ApplicationController#cdn_asset_url, the private helper
# redirect_to_cdn_url uses to front DigitalOcean Spaces origin URLs with the
# Spaces CDN custom subdomain (config.x.spaces_cdn_host, set to
# "cdn.example.com" in test.rb). No request/response context is needed since
# the method only reads config and parses/rewrites a URL string.
class ApplicationControllerTest < ActiveSupport::TestCase
  setup do
    @controller = ApplicationController.new
  end

  test "leaves a relative fallback path unchanged" do
    assert_equal "/icon.svg", @controller.send(:cdn_asset_url, "/icon.svg")
  end

  test "leaves a non-Spaces URL unchanged" do
    url = "https://example.com/foo"
    assert_equal url, @controller.send(:cdn_asset_url, url)
  end

  test "rewrites a Spaces origin URL's host to the configured CDN host, preserving path and query" do
    url = "https://pretext-plus-bucket.nyc3.digitaloceanspaces.com/some/key?X-Amz-Signature=abc&X-Amz-Expires=3600"

    assert_equal "https://cdn.example.com/some/key?X-Amz-Signature=abc&X-Amz-Expires=3600",
      @controller.send(:cdn_asset_url, url)
  end

  test "is a no-op when spaces_cdn_host isn't configured" do
    url = "https://pretext-plus-bucket.nyc3.digitaloceanspaces.com/some/key?X-Amz-Signature=abc"

    Rails.application.config.x.stub(:spaces_cdn_host, nil) do
      assert_equal url, @controller.send(:cdn_asset_url, url)
    end
  end
end
