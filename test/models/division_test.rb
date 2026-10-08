require "test_helper"

class DivisionTest < ActiveSupport::TestCase
  test "ref must be unique among assets in the same project" do
    project = projects(:one)
    Asset.create!(project: project, ref: "taken_ref", kind: :file)

    division = Division.new(project: project, ref: "taken_ref", source_format: :pretext)

    assert_not division.valid?
    assert_includes division.errors[:ref], "has already been taken"
  end

  # The starter matters more here than for a document: an empty <slideshow> builds to a
  # blank deck rather than an error, so a missing starter would look like a broken build.
  test "a slideshow's root division starts from the deck starter for its markup style" do
    { pretext: "<slideshow", latex: "\\slideshow{", markdown: "division: slideshow" }
      .each do |format, marker|
        project = Project.create!(user: users(:one), title: "Deck", document_type: :slideshow,
                                  divisions_attributes: [ { is_root: true, ref: "document",
                                                            source_format: format } ])

        assert_includes project.root_division.source, marker,
                        "expected the #{format} deck starter"
      end
  end

  test "a document's root division is unaffected by the slideshow starters" do
    project = Project.create!(user: users(:one), title: "Doc",
                              divisions_attributes: [ { is_root: true, ref: "document",
                                                        source_format: :pretext } ])

    assert_includes project.root_division.source, "<article"
  end

  # A non-root division is a <section> either way. Handing it the deck starter would nest
  # a second <slideshow> root inside the document.
  test "a slideshow's non-root division does not get the deck starter" do
    project = Project.create!(user: users(:one), title: "Deck", document_type: :slideshow,
                              divisions_attributes: [ { is_root: true, ref: "document",
                                                        source_format: :pretext } ])

    child = project.divisions.create!(ref: "part_two", source_format: :pretext)

    assert_not_includes child.source, "<slideshow"
  end

  # ---- exactly one root per project ----------------------------------------

  test "a root division cannot be destroyed on its own" do
    root = divisions(:one)

    assert_not root.destroy
    assert_includes root.errors[:base], "The root division cannot be deleted"
    assert Division.exists?(root.id)
    assert_raises(ActiveRecord::RecordNotDestroyed) { root.destroy! }
  end

  test "a non-root division can still be destroyed" do
    child = projects(:one).divisions.create!(ref: "child", source: "<section/>")

    assert child.destroy
    assert_not Division.exists?(child.id)
  end

  test "destroying the project takes its root division with it" do
    project = projects(:one)
    root = project.root_division

    project.destroy!

    assert_not Division.exists?(root.id)
  end

  test "a root division cannot step down" do
    root = divisions(:one)

    assert_not root.update(is_root: false)
    assert_includes root.errors[:is_root], "cannot be changed"
    assert root.reload.is_root?
  end

  test "a non-root division cannot be promoted" do
    child = projects(:one).divisions.create!(ref: "child", source: "<section/>")

    assert_not child.update(is_root: true)
    assert_not child.reload.is_root?
  end

  test "a division cannot move to another project" do
    root = divisions(:one)

    assert_not root.update(project: projects(:two))
    assert_includes root.errors[:project], "cannot be changed"
    assert_equal projects(:one), root.reload.project
  end

  test "a second root cannot be created" do
    second = projects(:one).divisions.build(ref: "another", is_root: true)

    assert_not second.valid?
    assert_raises(ActiveRecord::RecordNotUnique) { second.save!(validate: false) }
  end
end
