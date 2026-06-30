require "test_helper"
require "zip"

class FetchBuildZipJobTest < ActiveJob::TestCase
  def fake_zip(entries)
    buffer = Zip::OutputStream.write_buffer do |zos|
      entries.each do |path, content|
        zos.put_next_entry(path)
        zos.write(content)
      end
    end
    buffer.string
  end

  # builds(:in_progress) has no pre-existing build_files, avoiding unique-path conflicts.
  def build
    builds(:in_progress)
  end

  test "posts pretext_source, BUILD_TOKEN, and format=zip to build server" do
    captured_params = nil
    zip_body = fake_zip("index.html" => "<html></html>")
    fake_response = Struct.new(:body).new(zip_body)

    Net::HTTP.stub(:post_form, ->(_uri, params) { captured_params = params; fake_response }) do
      FetchBuildZipJob.perform_now(build)
    end

    assert_equal build.project.pretext_source, captured_params[:source]
    assert_equal ENV["BUILD_TOKEN"], captured_params[:token]
    assert_equal "zip", captured_params[:format]
  end

  test "attaches response body as zip and marks build success" do
    zip_body = fake_zip("index.html" => "<html></html>")
    fake_response = Struct.new(:body).new(zip_body)

    Net::HTTP.stub(:post_form, fake_response) do
      FetchBuildZipJob.perform_now(build)
    end

    assert build.reload.zip.attached?
    assert build.success?
  end

  test "creates a BuildFile for each entry in the ZIP" do
    zip_body = fake_zip(
      "index.html" => "<html>home</html>",
      "chapter-one.html" => "<html>chapter</html>",
      "images/fig.png" => "PNG\x89"
    )
    fake_response = Struct.new(:body).new(zip_body)

    assert_difference -> { build.build_files.count }, 3 do
      Net::HTTP.stub(:post_form, fake_response) do
        FetchBuildZipJob.perform_now(build)
      end
    end

    assert build.build_files.find_by(relative_path: "index.html").blob.attached?
    assert build.build_files.find_by(relative_path: "chapter-one.html").blob.attached?
    assert build.build_files.find_by(relative_path: "images/fig.png").blob.attached?
  end

  test "stores correct content in each BuildFile blob" do
    zip_body = fake_zip("index.html" => "<html>hello</html>")
    fake_response = Struct.new(:body).new(zip_body)

    Net::HTTP.stub(:post_form, fake_response) do
      FetchBuildZipJob.perform_now(build)
    end

    content = build.build_files.find_by!(relative_path: "index.html").blob.download
    assert_equal "<html>hello</html>", content
  end

  test "creates a BuildFile for each project_asset with a file" do
    library_asset = library_assets(:image_one)
    library_asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )
    zip_body = fake_zip("index.html" => "<html></html>")
    fake_response = Struct.new(:body).new(zip_body)

    Net::HTTP.stub(:post_form, fake_response) do
      FetchBuildZipJob.perform_now(build)
    end

    build_file = build.build_files.find_by(relative_path: "external/#{library_asset.external_filename}")
    assert build_file
    assert build_file.blob.attached?
    assert_equal library_asset.file.blob, build_file.blob.blob
  end

  test "skips project_assets whose library_asset has no file" do
    zip_body = fake_zip("index.html" => "<html></html>")
    fake_response = Struct.new(:body).new(zip_body)

    Net::HTTP.stub(:post_form, fake_response) do
      FetchBuildZipJob.perform_now(build)
    end

    assert build.build_files.none? { |bf| bf.relative_path.start_with?("external/") }
  end

  test "marks build failed and re-raises on error" do
    Net::HTTP.stub(:post_form, ->(_uri, _params) { raise "network error" }) do
      assert_raises(RuntimeError) { FetchBuildZipJob.perform_now(build) }
    end

    assert build.reload.failed?
  end
end
