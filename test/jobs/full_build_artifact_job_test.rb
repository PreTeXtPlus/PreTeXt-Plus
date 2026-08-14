require "test_helper"
require "zip"

class FullBuildArtifactJobTest < ActiveJob::TestCase
  ARTIFACT_URL = "https://build.example.com/builds/job-123/artifact".freeze

  def fake_zip(entries)
    Zip::OutputStream.write_buffer do |zos|
      entries.each do |path, content|
        zos.put_next_entry(path)
        zos.write(content)
      end
    end.string
  end

  def http_response(klass, code, body)
    res = klass.new("1.1", code, "")
    res.instance_variable_set(:@read, true)
    res.define_singleton_method(:body) { body }
    res
  end

  # builds(:in_progress) has no pre-existing build_files, avoiding unique-path conflicts.
  def build
    builds(:in_progress)
  end

  def stub_artifact(response, &blk)
    Net::HTTP.stub(:start, ->(*_args, **_kw) { response }, &blk)
  end

  test "creates a BuildFile per zip entry, attaches the zip, and marks success" do
    response = http_response(Net::HTTPOK, "200", fake_zip(
      "index.html" => "<html>home</html>",
      "images/fig.png" => "PNG\x89"
    ))

    assert_difference -> { build.build_files.count }, 2 do
      stub_artifact(response) { FullBuildArtifactJob.perform_now(build, ARTIFACT_URL) }
    end

    assert build.reload.success?
    assert build.zip.attached?
    assert_equal "<html>home</html>",
      build.build_files.find_by!(relative_path: "index.html").blob.download
  end

  # Output is output: the import does not branch on how the build server graded the build.
  # #perform reads received_from_server_flagged? off the row before the completing mark!
  # overwrites it, and lands on success_awaiting_review instead of plain success -- that
  # status is what holds the output back from readers until the author accepts it.
  test "importing output from a failed build keeps it flagged and out of the live slot" do
    build.mark!(:received_from_server_flagged)
    response = http_response(Net::HTTPOK, "200", fake_zip("index.html" => "<html>home</html>"))

    stub_artifact(response) { FullBuildArtifactJob.perform_now(build, ARTIFACT_URL) }

    assert build.reload.successful?
    assert build.success_awaiting_review?
    assert_equal 1, build.build_files.count, "the output still has to import"
    assert_not_equal build, build.target.reload.current_build
    assert_equal build, build.target.build_awaiting_review
  end

  # The moment a build succeeds is the moment history is trimmed: nothing else grows it,
  # so nothing else needs to prune it.
  test "a successful import prunes builds beyond the retention window" do
    target = build.target
    old_successes = 3.times.map do |i|
      target.builds.create!(created_at: (i + 2).days.ago, status: :success)
    end
    target.sync_from_builds!

    response = http_response(Net::HTTPOK, "200", fake_zip("index.html" => "<html>home</html>"))
    stub_artifact(response) { FullBuildArtifactJob.perform_now(build, ARTIFACT_URL) }

    # The fresh success plus the newest old one fill the window; the rest are gone.
    assert build.reload.success?
    assert Build.exists?(old_successes[0].id)
    assert_empty Build.where(id: old_successes[1..].map(&:id))
  end

  test "marks build failed on a non-success artifact response" do
    response = http_response(Net::HTTPInternalServerError, "500", "boom")

    stub_artifact(response) { FullBuildArtifactJob.perform_now(build, ARTIFACT_URL) }

    assert build.reload.failed?
  end

  # This request used to have no timeout at all, so a build server that accepted the
  # connection and then went quiet hung the job -- and, because `success` from the server
  # only means `received_from_server`, left the dashboard row saying Building for good.
  test "a build server that stops answering fails the build instead of hanging" do
    build.mark!(:received_from_server, log: "Success!  Built requested target(s) without errors.")

    Net::HTTP.stub(:start, ->(*_args, **_kw) { raise Net::ReadTimeout }) do
      assert_nothing_raised { FullBuildArtifactJob.perform_now(build, ARTIFACT_URL) }
    end

    assert build.reload.failed?
    assert_match(/Success!/, build.log, "the CLI's own log is the part an author can act on")
    assert_match(/timed out/, build.log)
  end

  test "the artifact download is given longer than an ordinary build server call" do
    passed = nil
    Net::HTTP.stub(:start, ->(*_args, **kwargs) {
      passed = kwargs
      http_response(Net::HTTPOK, "200", fake_zip("index.html" => "<html>home</html>"))
    }) do
      FullBuildArtifactJob.perform_now(build, ARTIFACT_URL)
    end

    assert_equal FullBuildArtifactJob::ARTIFACT_READ_TIMEOUT, passed[:read_timeout]
    assert_equal FullBuildServer::TIMEOUTS[:open_timeout], passed[:open_timeout]
  end

  test "marks build failed and re-raises on error" do
    Net::HTTP.stub(:start, ->(*_args, **_kw) { raise "network error" }) do
      assert_raises(RuntimeError) { FullBuildArtifactJob.perform_now(build, ARTIFACT_URL) }
    end

    assert build.reload.failed?
  end
end
