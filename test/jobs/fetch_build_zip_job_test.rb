require "test_helper"

class FetchBuildZipJobTest < ActiveJob::TestCase
  test "posts pretext_source, BUILD_TOKEN, and format=zip to build server" do
    build = builds(:one)
    captured_params = nil
    fake_response = Struct.new(:body).new("PK\x03\x04fake zip content")

    Net::HTTP.stub(:post_form, ->(_uri, params) { captured_params = params; fake_response }) do
      FetchBuildZipJob.perform_now(build)
    end

    assert_equal build.project.pretext_source, captured_params[:source]
    assert_equal ENV["BUILD_TOKEN"], captured_params[:token]
    assert_equal "zip", captured_params[:format]
  end

  test "attaches response body as zip and marks build success" do
    build = builds(:one)
    zip_content = "PK\x03\x04fake zip content"
    fake_response = Struct.new(:body).new(zip_content)

    Net::HTTP.stub(:post_form, fake_response) do
      FetchBuildZipJob.perform_now(build)
    end

    assert build.reload.zip.attached?
    assert build.success?
  end

  test "marks build failed and re-raises on error" do
    build = builds(:one)

    Net::HTTP.stub(:post_form, ->(_uri, _params) { raise "network error" }) do
      assert_raises(RuntimeError) { FetchBuildZipJob.perform_now(build) }
    end

    assert build.reload.failed?
  end
end
