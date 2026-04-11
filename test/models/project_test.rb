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

  test "default_content_for returns pmd template" do
    content = Project.default_content_for("pmd")
    assert_includes content, "# Welcome to PreTeXt.Plus!"
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

  test "before_update wraps pretext_source when source_format is latex" do
    project = projects(:one)
    captured_params = nil
    fake_response = Struct.new(:body).new("<html><body>latex</body></html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) {
      captured_params = params
      fake_response
    }) do
      project.update!(
        title: "Updated LaTeX Project",
        source_format: :latex,
        source: "\\section{Raw LaTeX}",
        pretext_source: "<section><title>Converted</title></section>"
      )
    end

    assert_includes captured_params[:source], "<pretext>"
    assert_includes captured_params[:source], "<article label=\"article\">"
    assert_includes captured_params[:source], "<title>Updated LaTeX Project</title>"
    assert_includes captured_params[:source], "<section><title>Converted</title></section>"
    assert_equal "<html><body>latex</body></html>", project.html_source
  end

  test "belongs to user" do
    project = projects(:one)
    assert_equal users(:one), project.user
  end

  # --- Docinfo ---

  test "full_pretext_source includes docinfo when present" do
    project = projects(:one)
    project.docinfo = "<docinfo><macros>\\newcommand{\\N}{\\mathbb{N}}</macros></docinfo>"
    project.source = "<section><p>Hello</p></section>"
    xml = project.full_pretext_source
    assert xml.start_with?("<pretext>")
    assert xml.end_with?("</pretext>")
    assert_includes xml, "<docinfo>"
    assert_includes xml, "<macros>\\newcommand{\\N}{\\mathbb{N}}</macros>"
    assert_includes xml, "<article label=\"article\">"
    assert_includes xml, "<section><p>Hello</p></section>"
  end

  test "full_pretext_source works without docinfo" do
    project = projects(:one)
    project.source = "<section><p>Hello</p></section>"
    xml = project.full_pretext_source
    assert xml.start_with?("<pretext>")
    assert_not_includes xml, "<docinfo>"
    assert_includes xml, "<article label=\"article\">"
  end

  test "set_html_source sends assembled source for pretext projects" do
    project = projects(:one)
    project.source = "<section><title>Hello</title><p>World</p></section>"
    project.docinfo = "<docinfo><macros>\\newcommand{\\N}{\\mathbb{N}}</macros></docinfo>"
    captured_params = nil
    fake_response = Struct.new(:body).new("<html>built</html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) {
      captured_params = params
      fake_response
    }) do
      project.update!(title: "With Docinfo")
    end

    assert_includes captured_params[:source], "<pretext>"
    assert_includes captured_params[:source], "<docinfo>"
    assert_includes captured_params[:source], "<macros>\\newcommand{\\N}{\\mathbb{N}}</macros>"
    assert_includes captured_params[:source], "<title>With Docinfo</title>"
    assert_includes captured_params[:source], project.source
  end

  test "docinfo-only update triggers rebuild" do
    project = projects(:one)
    captured_params = nil
    fake_response = Struct.new(:body).new("<html>docinfo rebuild</html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) {
      captured_params = params
      fake_response
    }) do
      project.update!(docinfo: "<docinfo><macros>\\newcommand{\\A}{\\mathbb{A}}</macros></docinfo>")
    end

    assert_includes captured_params[:source], "<docinfo><macros>\\newcommand{\\A}{\\mathbb{A}}</macros></docinfo>"
    assert_equal "<html>docinfo rebuild</html>", project.html_source
  end

  test "before_update uses raw source for latex when pretext_source is missing" do
    project = projects(:one)
    captured_params = nil
    fake_response = Struct.new(:body).new("<html><body>latex-fallback</body></html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) {
      captured_params = params
      fake_response
    }) do
      project.update!(
        title: "LaTeX Fallback",
        source_format: :latex,
        source: "\\section{Raw LaTeX}",
        pretext_source: nil
      )
    end

    assert_equal "\\section{Raw LaTeX}", captured_params[:source]
    assert_equal "<html><body>latex-fallback</body></html>", project.html_source
  end
end
