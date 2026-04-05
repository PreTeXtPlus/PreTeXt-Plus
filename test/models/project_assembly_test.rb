require "test_helper"

class ProjectAssemblyTest < ActiveSupport::TestCase
  test "assemble_source falls back to legacy source when no elements" do
    project = projects(:one)
    # Remove all source elements to test fallback
    project.source_elements.destroy_all
    assert_equal project.source, project.assemble_source
  end

  test "assemble_source builds XML from elements for article" do
    project = projects(:one)
    project.update_columns(document_type: 0, title: "Test Article")

    xml = project.assemble_source
    assert xml.start_with?("<pretext>")
    assert xml.end_with?("</pretext>")
    assert_includes xml, "<article>"
    assert_includes xml, "<title>Test Article</title>"
    assert_includes xml, "<section>"
    assert_includes xml, "</article>"
  end

  test "assemble_source builds XML from elements for book" do
    project = projects(:two)
    project.update_columns(document_type: 1, title: "Test Book")

    xml = project.assemble_source
    assert xml.start_with?("<pretext>")
    assert_includes xml, "<book>"
    assert_includes xml, "<title>Test Book</title>"
    assert_includes xml, "<frontmatter></frontmatter>"
    assert_includes xml, "<chapter><title>Chapter One</title>"
    assert_includes xml, "<introduction>"
    assert_includes xml, "<section><title>First Section</title>"
    assert_includes xml, "<backmatter></backmatter>"
    assert_includes xml, "</book>"
  end

  test "assemble_source places docinfo before document tag" do
    project = projects(:one)
    project.update_columns(document_type: 0, title: "Test")

    # Shift existing elements to make room for docinfo at position 0
    project.source_elements.update_all("position = position + 1")
    project.source_elements.create!(
      element_type: "docinfo",
      source: "<author>Test Author</author>",
      position: 0
    )

    xml = project.assemble_source
    docinfo_pos = xml.index("<docinfo>")
    article_pos = xml.index("<article>")
    assert docinfo_pos < article_pos, "docinfo should appear before the document tag"
  end

  test "scaffold_elements! creates article structure" do
    project = Project.create!(
      user: users(:one),
      title: "New Article",
      source_format: :pretext,
      document_type: :article
    )
    project.scaffold_elements!

    elements = project.source_elements.reload
    assert_equal 1, elements.count
    assert_equal "section", elements.first.element_type
    assert_equal "Welcome", elements.first.title
    assert elements.first.source.present?
  end

  test "scaffold_elements! creates book structure" do
    stub_build_server do
      project = Project.create!(
        user: users(:one),
        title: "New Book",
        source_format: :pretext,
        document_type: :book
      )
      project.scaffold_elements!

      root_elements = project.source_elements.where(parent_id: nil).order(:position)
      types = root_elements.map(&:element_type)
      assert_includes types, "frontmatter"
      assert_includes types, "chapter"
      assert_includes types, "backmatter"

      chapter = root_elements.find { |e| e.element_type == "chapter" }
      assert_equal "Chapter 1", chapter.title
      assert_equal 1, chapter.children.count
      assert_equal "section", chapter.children.first.element_type
    end
  end
end
