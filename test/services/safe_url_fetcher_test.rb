require "test_helper"

class SafeUrlFetcherTest < ActiveSupport::TestCase
  # A fake Net::HTTPResponse supporting the block form of #read_body used by
  # SafeUrlFetcher#call. `success` controls is_a?(Net::HTTPSuccess).
  def fake_response(content_type: "image/png", chunks: [ "bytes" ], success: true)
    response = Object.new
    response.define_singleton_method(:is_a?) { |klass| success && klass == Net::HTTPSuccess }
    response.define_singleton_method(:code) { success ? "200" : "404" }
    response.define_singleton_method(:content_type) { content_type }
    response.define_singleton_method(:read_body) { |&block| chunks.each { |chunk| block.call(chunk) } }
    response
  end

  # Bypasses ssrf_filter's own (separately tested upstream) DNS/IP validation
  # and connection handling, and just hands the block the fake response --
  # this isolates these tests to SafeUrlFetcher's own content-type/size logic.
  def stub_fetch(response, &test_block)
    SsrfFilter.stub(:get, ->(*, **, &blk) { blk.call(response) }, &test_block)
  end

  test "rejects non-http(s) schemes" do
    error = assert_raises(SafeUrlFetcher::UnsafeUrlError) { SafeUrlFetcher.call("ftp://example.com/pic.png") }
    assert_match(/scheme/, error.message)
  end

  test "rejects an invalid url" do
    assert_raises(SafeUrlFetcher::UnsafeUrlError) { SafeUrlFetcher.call("not a url") }
  end

  test "rejects a url whose host resolves to a private/loopback address" do
    Resolv.stub(:getaddresses, [ "127.0.0.1" ]) do
      error = assert_raises(SafeUrlFetcher::UnsafeUrlError) { SafeUrlFetcher.call("http://evil.example/pic.png") }
      assert_match(/no public ip/i, error.message)
    end
  end

  test "rejects a url whose host cannot be resolved" do
    Resolv.stub(:getaddresses, []) do
      assert_raises(SafeUrlFetcher::UnsafeUrlError) { SafeUrlFetcher.call("http://nowhere.example/pic.png") }
    end
  end

  test "rejects a non-image content type" do
    stub_fetch(fake_response(content_type: "text/html")) do
      error = assert_raises(SafeUrlFetcher::FetchError) { SafeUrlFetcher.call("http://example.com/page.html") }
      assert_match(/image/, error.message)
    end
  end

  test "rejects a response larger than the size cap" do
    chunk = "a" * 1.megabyte
    chunks = Array.new((SafeUrlFetcher::MAX_BYTES / chunk.bytesize) + 2, chunk)
    stub_fetch(fake_response(chunks: chunks)) do
      error = assert_raises(SafeUrlFetcher::FetchError) { SafeUrlFetcher.call("http://example.com/big.png") }
      assert_match(/too large/, error.message)
    end
  end

  test "rejects an unsuccessful response" do
    stub_fetch(fake_response(success: false)) do
      error = assert_raises(SafeUrlFetcher::FetchError) { SafeUrlFetcher.call("http://example.com/missing.png") }
      assert_match(/404/, error.message)
    end
  end

  test "returns the bytes and content type on success" do
    stub_fetch(fake_response(content_type: "image/png", chunks: [ "fake-", "png-bytes" ])) do
      body, content_type = SafeUrlFetcher.call("http://example.com/pic.png")
      assert_equal "fake-png-bytes", body
      assert_equal "image/png", content_type
    end
  end
end
