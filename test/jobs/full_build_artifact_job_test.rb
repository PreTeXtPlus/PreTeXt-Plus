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

  test "marks build failed and re-raises on error" do
    Net::HTTP.stub(:start, ->(*_args, **_kw) { raise "network error" }) do
      assert_raises(RuntimeError) { FullBuildArtifactJob.perform_now(build, ARTIFACT_URL) }
    end

    assert build.reload.failed?
  end
end
