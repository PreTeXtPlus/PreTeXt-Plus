require "test_helper"

class AssetRendererTest < ActiveSupport::TestCase
  STATUS_URL = "/generate/job-1".freeze

  setup do
    @project = projects(:one)
    @asset = Content.new(project: @project, kind: :authored_asset, source_format: "sageplot", ref: "sine",
                         title: "Sine", source: "plot(sin(x), (x, -pi, pi))")
  end

  def http_response(code, body)
    response = Net::HTTPResponse::CODE_TO_OBJ.fetch(code.to_s).new("1.1", code.to_s, "")
    response.instance_variable_set(:@read, true)
    response.instance_variable_set(:@body, body)
    response
  end

  # Answers each GET from `pages`, a path → body (or [code, body]) map.
  def with_server(pages, &block)
    getter = lambda do |path, **|
      answer = pages.fetch(path) { flunk "unexpected GET #{path}" }
      answer.is_a?(Array) ? http_response(*answer) : http_response(200, answer)
    end
    FullBuildServer.stub(:get, getter, &block)
  end

  def status(overrides)
    { "job_id" => "job-1", "kind" => "generate", "status" => "success", "files" => [] }.merge(overrides).to_json
  end

  # ---- submit ---------------------------------------------------------------

  test "submit ships a one-figure archive for the asset's element under the project's id, and returns the status URL" do
    archive = StringIO.new("zip")
    sent = nil
    poster = lambda do |path, fields, **|
      sent = { path: path, fields: fields }
      http_response(202, { job_id: "job-1", status: "queued", status_url: STATUS_URL }.to_json)
    end

    builder = Struct.new(:build).new(archive)
    status_url = GenerateArchiveBuilder.stub(:new, ->(_p, _a) { builder }) do
      FullBuildServer.stub(:post_form, poster) { AssetRenderer.submit(@project, @asset) }
    end

    assert_equal STATUS_URL, status_url
    assert_equal "/generate", sent[:path]
    fields = sent[:fields].to_h { |name, value, *| [ name, value ] }
    assert_same archive, fields["archive"]
    assert_equal "web", fields["target"]
    assert_equal "sageplot", fields["assets"]
    assert_equal @project.id, fields["project_id"]
  end

  test "submit raises when the build server refuses" do
    builder = Struct.new(:build).new(StringIO.new("zip"))
    GenerateArchiveBuilder.stub(:new, ->(_p, _a) { builder }) do
      FullBuildServer.stub(:post_form, ->(*, **) { http_response(401, "Invalid or missing token") }) do
        error = assert_raises(AssetRenderer::Error) { AssetRenderer.submit(@project, @asset) }
        assert_match(/HTTP 401/, error.message)
      end
    end
  end

  # ---- poll -----------------------------------------------------------------

  test "a job still queued or running is pending, with the server's word for it" do
    with_server(STATUS_URL => status("status" => "started")) do
      result = AssetRenderer.poll(STATUS_URL, "sageplot")
      assert_equal "pending", result.status
      assert_equal "started", result.message
    end
  end

  test "a sageplot's picture is the SVG file the job made" do
    pages = {
      STATUS_URL => status("files" => [ "sageplot/0123456789abcdef0123456789abcdef.svg" ]),
      "#{STATUS_URL}/files/sageplot/0123456789abcdef0123456789abcdef.svg" => "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
    }
    with_server(pages) do
      result = AssetRenderer.poll(STATUS_URL, "sageplot")
      assert_equal "success", result.status
      assert_equal "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", result.svg
    end
  end

  # pretext-html reads the aspect ratio off this same inline svg, so it is what a
  # 2D figure's page holds. viewBox must survive: the HTML4 parser would lowercase it.
  test "an asymptote's picture is the inline svg lifted out of its HTML page, as XML" do
    page = <<~HTML
      <!DOCTYPE html><html><head><title>circle</title></head>
      <body><svg xmlns="http://www.w3.org/2000/svg" width="86pt" height="86pt" viewBox="0 0 86 86">
      <g><path d="M1 2"/><text>a &amp; b</text></g></svg></body></html>
    HTML
    pages = {
      STATUS_URL => status("files" => [ "asymptote/0123456789abcdef0123456789abcdef.html" ]),
      "#{STATUS_URL}/files/asymptote/0123456789abcdef0123456789abcdef.html" => page
    }
    with_server(pages) do
      result = AssetRenderer.poll(STATUS_URL, "asymptote")
      assert_equal "success", result.status
      svg = Nokogiri::XML(result.svg, &:strict)
      assert_equal "svg", svg.root.name
      assert_equal "http://www.w3.org/2000/svg", svg.root.namespace.href
      assert_equal "0 0 86 86", svg.root["viewBox"]
      assert_equal "a & b", svg.at_css("text").text
    end
  end

  test "a 3D asymptote page, a canvas with no svg, is reported rather than stored" do
    pages = {
      STATUS_URL => status("files" => [ "asymptote/0123456789abcdef0123456789abcdef.html" ]),
      "#{STATUS_URL}/files/asymptote/0123456789abcdef0123456789abcdef.html" => "<html><body><canvas width=\"400\"></canvas><script></script></body></html>"
    }
    with_server(pages) do
      result = AssetRenderer.poll(STATUS_URL, "asymptote")
      assert_equal "failed", result.status
      assert_equal AssetRenderer::THREE_D, result.message
    end
  end

  test "a 3D sageplot makes an HTML page where a 2D one makes an SVG" do
    with_server(STATUS_URL => status("files" => [ "sageplot/0123456789abcdef0123456789abcdef.html" ])) do
      result = AssetRenderer.poll(STATUS_URL, "sageplot")
      assert_equal "failed", result.status
      assert_equal AssetRenderer::THREE_D, result.message
    end
  end

  # The CLI logs a figure it could not make and may still exit cleanly.
  test "a successful job that made no picture fails with the log" do
    with_server(STATUS_URL => status("files" => [], "log" => "Failed to generate sageplot diagram sine.sage")) do
      result = AssetRenderer.poll(STATUS_URL, "sageplot")
      assert_equal "failed", result.status
      assert_equal AssetRenderer::NO_PICTURE, result.message
      assert_includes result.log, "sine.sage"
    end
  end

  test "a failed job carries its log, fetched from the log URL when the status has none" do
    pages = {
      STATUS_URL => status("status" => "failed", "log_url" => "#{STATUS_URL}/log"),
      "#{STATUS_URL}/log" => "! Undefined control sequence."
    }
    with_server(pages) do
      result = AssetRenderer.poll(STATUS_URL, "asymptote")
      assert_equal "failed", result.status
      assert_equal AssetRenderer::FAILED, result.message
      assert_equal "! Undefined control sequence.", result.log
    end
  end

  test "a build server that cannot be read raises" do
    with_server(STATUS_URL => [ 502, "bad gateway" ]) do
      assert_raises(AssetRenderer::Error) { AssetRenderer.poll(STATUS_URL, "asymptote") }
    end
  end
end
