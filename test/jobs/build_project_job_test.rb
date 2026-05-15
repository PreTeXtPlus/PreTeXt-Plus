require "test_helper"

class BuildProjectJobTest < ActiveJob::TestCase
  test "build job marks project succeeded and stores html" do
    project = projects(:one)
    fake_response = Struct.new(:body).new("<html><body>job</body></html>")

    Net::HTTP.stub(:post_form, fake_response) do
      BuildProjectJob.perform_now(project.id)
    end

    project.reload
    assert_equal "succeeded", project.build_status
    assert_equal "<html><body>job</body></html>", project.html_source
    assert_equal "index.html", project.artifact_manifest["entrypoint"]
    assert_equal 1, project.build_artifacts.count
    assert_equal "<html><body>job</body></html>", project.artifact_attachment_for("index.html").download
    assert_match %r{\Aprojects/.+/builds/legacy-}, project.artifact_prefix
    assert_not_nil project.last_build_started_at
    assert_not_nil project.last_build_finished_at
    assert_nil project.last_build_error
  end

  test "build job marks project failed when builder raises" do
    project = projects(:one)

    Net::HTTP.stub(:post_form, ->(_uri, _params) { raise Errno::ECONNREFUSED.new }) do
      assert_raises(Errno::ECONNREFUSED) do
        BuildProjectJob.perform_now(project.id)
      end
    end

    project.reload
    assert_equal "failed", project.build_status
    assert_equal({}, project.artifact_manifest)
    assert_nil project.artifact_prefix
    assert_not_nil project.last_build_finished_at
    assert_includes project.last_build_error.to_s, "Connection refused"
  end

  test "build job persists multiple artifacts from json payload" do
    project = projects(:one)
    payload = {
      "manifest" => {
        "version" => 1,
        "build_id" => "bld-json",
        "generated_at" => Time.current.iso8601,
        "entrypoint" => "index.html",
        "files" => [
          { "path" => "index.html", "content_type" => "text/html" },
          { "path" => "assets/site.css", "content_type" => "text/css" },
          { "path" => "assets/site.js", "content_type" => "application/javascript" }
        ],
        "inline_files" => {
          "index.html" => "<html><head><link rel=\"stylesheet\" href=\"assets/site.css\"></head><body><script src=\"assets/site.js\"></script></body></html>",
          "assets/site.css" => "body { background: #fff; }",
          "assets/site.js" => "console.log('ready')"
        }
      }
    }

    fake_response = Struct.new(:body) do
      def to_hash
        { "content-type" => [ "application/json" ] }
      end
    end.new(payload.to_json)

    Net::HTTP.stub(:post_form, fake_response) do
      BuildProjectJob.perform_now(project.id)
    end

    project.reload
    assert_equal "succeeded", project.build_status
    assert_equal 3, project.build_artifacts.count
    assert_equal "body { background: #fff; }", project.artifact_attachment_for("assets/site.css").download
    assert_equal "console.log('ready')", project.artifact_attachment_for("assets/site.js").download
  end
end