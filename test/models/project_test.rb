require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  test "before_update calls build server and sets html_source" do
    project = projects(:one)
    stub_build_server do
      project.update!(title: "Updated Title")
    end
    assert_equal "<html><body>stub</body></html>", project.html_source
  end

  test "before_update sends pretext_source to build server" do
    project = projects(:one)
    captured_params = nil
    fake_response = Struct.new(:body).new("<html>built</html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) {
      captured_params = params
      fake_response
    }) do
      project.update!(title: "Updated")
    end

    assert_equal project.pretext_source, captured_params[:source]
  end

  test "belongs to user" do
    project = projects(:one)
    assert_equal users(:one), project.user
  end
end
