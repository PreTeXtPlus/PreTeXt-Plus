require "test_helper"

class SetHtmlSourceJobTest < ActiveJob::TestCase
  test "posts pretext_source and BUILD_TOKEN to build server" do
    project = projects(:one)
    captured_params = nil
    fake_response = Struct.new(:body).new("<html>built</html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) { captured_params = params; fake_response }) do
      SetHtmlSourceJob.perform_now(project)
    end

    assert_equal project.pretext_source, captured_params[:source]
    assert_equal Rails.application.credentials.dig(:preview_build, :token), captured_params[:token]
  end
end
