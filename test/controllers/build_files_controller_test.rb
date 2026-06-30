require "test_helper"

class BuildFilesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @build = builds(:one)
    sign_in @user
  end

  def attach_blob(build_file, content, filename)
    build_file.blob.attach(
      io: StringIO.new(content),
      filename: filename,
      content_type: Marcel::MimeType.for(name: filename)
    )
    build_file
  end

  test "serves HTML file inline" do
    bf = attach_blob(build_files(:index), "<html>hello</html>", "index.html")

    get build_file_url(build_id: @build.id, relative_path: bf.relative_path)

    assert_response :success
    assert_includes response.content_type, "text/html"
    assert_includes response.body, "<html>hello</html>"
  end

  test "redirects non-HTML file to blob URL" do
    bf = build_files(:index)
    bf.update!(relative_path: "images/fig.png")
    attach_blob(bf, "PNG\x89", "fig.png")

    get build_file_url(build_id: @build.id, relative_path: bf.relative_path)

    assert_response :redirect
  end

  test "returns not found for missing relative path" do
    get build_file_url(build_id: @build.id, relative_path: "nonexistent.html")

    assert_response :not_found
  end

  test "redirects when user does not own the build" do
    sign_in users(:two)

    get build_file_url(build_id: @build.id, relative_path: "index.html")

    assert_redirected_to projects_path
  end

  test "handles nested paths in relative_path" do
    bf = attach_blob(build_files(:nested_index), "<html>appendix</html>", "index.html")

    get build_file_url(build_id: @build.id, relative_path: bf.relative_path)

    assert_response :success
    assert_includes response.body, "<html>appendix</html>"
  end

  test "empty path serves index.html" do
    attach_blob(build_files(:index), "<html>index</html>", "index.html")

    get build_file_url(build_id: @build.id)

    assert_response :success
    assert_includes response.body, "<html>index</html>"
  end
end
