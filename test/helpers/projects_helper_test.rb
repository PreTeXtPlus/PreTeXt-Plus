require "test_helper"

class ProjectsHelperTest < ActionView::TestCase
  test "project_format_icon renders the LaTeX logo for a LaTeX-format project" do
    html = project_format_icon(projects(:two))

    assert_match "latex-pretext-logo.svg", html
    assert_match 'alt="LaTeX-style PreTeXt logo"', html
  end

  test "project_format_icon renders the Markdown logo for a Markdown-format project" do
    project = Project.create!(user: users(:one))
    project.divisions.create!(ref: "document", is_root: true, source_format: :markdown)

    html = project_format_icon(project)

    assert_match "markdown-pretext-logo.svg", html
    assert_match 'alt="Markdown-style PreTeXt logo"', html
  end

  test "project_format_icon renders the plain PreTeXt logo for a pretext-format project" do
    html = project_format_icon(projects(:one))

    assert_match "pretext-logo.svg", html
    assert_no_match "latex-pretext-logo.svg", html
    assert_no_match "markdown-pretext-logo.svg", html
    assert_match 'alt="PreTeXt logo"', html
  end

  test "project_format_icon falls back to the plain PreTeXt logo when there is no root division" do
    # The "slides" fixture has no division fixture of its own.
    html = project_format_icon(projects(:slides))

    assert_match "pretext-logo.svg", html
    assert_match 'alt="PreTeXt logo"', html
  end

  test "project_format_icon also accepts the raw source_format string used by the new-project form" do
    assert_match "latex-pretext-logo.svg", project_format_icon("latex")
    assert_match "markdown-pretext-logo.svg", project_format_icon("markdown")
    assert_match "pretext-logo.svg", project_format_icon("pretext")
  end

  test "project_format_icon passes the classes: option through to the image tag" do
    html = project_format_icon(projects(:one), classes: "opacity-30")

    assert_match 'class="opacity-30"', html
  end
end
