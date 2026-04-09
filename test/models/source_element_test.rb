require "test_helper"

class SourceElementTest < ActiveSupport::TestCase
  test "valid source element with required fields" do
    element = SourceElement.new(
      project: projects(:one),
      element_type: "section",
      title: "Test Section",
      source: "<p>Hello</p>",
      position: 99
    )
    assert element.valid?
  end

  test "requires element_type" do
    element = SourceElement.new(project: projects(:one), position: 99)
    assert_not element.valid?
    assert element.errors[:element_type].any?
  end

  test "validates element_type inclusion" do
    element = SourceElement.new(
      project: projects(:one),
      element_type: "invalid_type",
      position: 99
    )
    assert_not element.valid?
    assert element.errors[:element_type].any?
  end

  test "container? returns true when element has children" do
    chapter = source_elements(:chapter_two)
    assert chapter.container?
    assert_not chapter.content?
  end

  test "content? returns true when element has no children" do
    section = source_elements(:section_one)
    assert section.content?
    assert_not section.container?
  end

  test "title_bearing? for chapter and section types" do
    assert source_elements(:chapter_two).title_bearing?
    assert source_elements(:section_two_a).title_bearing?
  end

  test "title_bearing? false for introduction" do
    assert_not source_elements(:intro_two).title_bearing?
  end

  test "to_xml for content element with title" do
    section = source_elements(:section_two_a)
    xml = section.to_xml
    assert_equal "<section><title>First Section</title><p>Section content A</p></section>", xml
  end

  test "to_xml for content element without title" do
    intro = source_elements(:intro_two)
    xml = intro.to_xml
    assert_equal "<introduction><p>Welcome to chapter one.</p></introduction>", xml
  end

  test "to_xml for container element recurses into children" do
    chapter = source_elements(:chapter_two)
    xml = chapter.to_xml

    assert xml.start_with?("<chapter>")
    assert xml.end_with?("</chapter>")
    assert_includes xml, "<title>Chapter One</title>"
    assert_includes xml, "<introduction>"
    assert_includes xml, "<section><title>First Section</title>"
    assert_includes xml, "<section><title>Second Section</title>"
  end

  test "destroying parent destroys children" do
    chapter = source_elements(:chapter_two)
    child_ids = chapter.children.pluck(:id)
    assert child_ids.any?

    chapter.destroy!
    child_ids.each do |id|
      assert_not SourceElement.exists?(id)
    end
  end

  test "default scope orders by position" do
    chapter = source_elements(:chapter_two)
    children = chapter.children.to_a
    assert_equal children.map(&:position), children.map(&:position).sort
  end
end
