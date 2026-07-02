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
    assert_equal ENV["BUILD_TOKEN"], captured_params[:token]
  end

  test "updates html_source with base tag prepended to build server response" do
    project = projects(:one)
    fake_response = Struct.new(:body).new("<html><body>built</body></html>")

    Net::HTTP.stub(:post_form, fake_response) do
      SetHtmlSourceJob.perform_now(project)
    end

    assert_equal "<base href=\"/projects/#{project.id}/share/external/\"><html><body>built</body></html>", project.reload.html_source
  end
end
