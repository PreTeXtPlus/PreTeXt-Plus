require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  test "default_content_for returns pretext template" do
    content = Project.default_content_for("pretext")
    assert_includes content, "<section>"
  end

  test "default_content_for returns latex template" do
    content = Project.default_content_for("latex")
    assert_includes content, "\\section{"
  end

  test "default_content_for returns pretext for unknown format" do
    content = Project.default_content_for("unknown")
    assert_includes content, "<section>"
  end

  test "source_format enum defaults to pretext" do
    project = projects(:one)
    assert project.pretext_source_format?
  end

  test "source_format can be set to latex" do
    project = projects(:one)
    project.source_format = :latex
    assert project.latex_source_format?
  end

  test "before_update calls build server and sets html_source" do
    project = projects(:one)
    stub_build_server do
      project.update!(title: "Updated Title")
    end
    assert_equal "<html><body>stub</body></html>", project.html_source
  end

  test "belongs to user" do
    project = projects(:one)
    assert_equal users(:one), project.user
  end
end
