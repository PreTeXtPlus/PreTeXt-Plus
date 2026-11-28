require "test_helper"

class CollectionTest < ActiveSupport::TestCase
  test "requires a name" do
    collection = users(:one).collections.build(name: "")
    assert_not collection.valid?
    assert collection.errors.added?(:name, :blank)
  end

  test "derives a slug from the name, unique among the owner's collections" do
    assert_equal "reading-list", users(:one).collections.create!(name: "Reading List!").slug
    assert_equal "reading-list-2", users(:one).collections.create!(name: "Reading list").slug
    assert_equal "my-collection-2", users(:one).collections.create!(name: "My Collection").slug
    # Another user's collections don't count.
    assert_equal "my-collection", users(:two).collections.create!(name: "My Collection").slug
    assert_equal "collection", users(:two).collections.create!(name: "★").slug
  end

  test "keeps a slug given explicitly, normalized" do
    assert_equal "intro-courses", users(:one).collections.create!(name: "Intro", slug: " Intro-Courses ").slug
  end

  test "rejects a slug that is malformed or already taken by the same owner" do
    [ "two words", "trailing-", "double--hyphen", "under_score" ].each do |slug|
      collection = users(:one).collections.build(name: "X", slug: slug)
      assert_not collection.valid?, slug
      assert collection.errors.of_kind?(:slug, :invalid), slug
    end

    renamed = collections(:public_one)
    renamed.slug = "my-collection"
    assert_not renamed.valid?
    assert renamed.errors.of_kind?(:slug, :taken)
  end

  test "defaults to private" do
    assert users(:one).collections.create!(name: "New").private_visibility?
  end

  test "lists projects in position order" do
    assert_equal [ projects(:slides), projects(:one) ], collections(:one).projects.to_a
  end

  test "new memberships go to the end" do
    collection = users(:one).collections.create!(name: "Fresh")
    first = collection.collection_memberships.create!(project: projects(:one))
    second = collection.collection_memberships.create!(project: projects(:slides))

    assert_equal 0, first.position
    assert_equal 1, second.position

    # After the current last, even when that leaves a gap at the front.
    collection_memberships(:one_slides).destroy!
    assert_equal 2, collections(:one).collection_memberships.create!(project: projects(:slides)).position
  end

  test "a project can be in several collections, but only once in each" do
    collections(:public_one).collection_memberships.create!(project: projects(:one))
    assert_equal 2, projects(:one).collections.count

    duplicate = collections(:one).collection_memberships.build(project: projects(:one))
    assert_not duplicate.valid?
    assert duplicate.errors.added?(:project_id, :taken, value: projects(:one).id)
  end

  test "only the project's owner can file it" do
    # users(:two) collaborates on projects(:one), but does not own it.
    collection = users(:two).collections.create!(name: "Theirs")
    membership = collection.collection_memberships.build(project: projects(:one))
    assert_not membership.valid?
    assert_includes membership.errors[:project], "must be owned by the collection's owner"

    assert collection.collection_memberships.build(project: projects(:two)).valid?
  end

  test "reorder_projects! sets the given order and ignores foreign ids" do
    collection = collections(:one)
    collection.reorder_projects!([ projects(:two).id, projects(:one).id ])

    assert_equal [ projects(:one), projects(:slides) ], collection.projects.to_a
    assert_equal [ projects(:one), projects(:slides) ], Collection.find(collection.id).projects.to_a
  end

  test "destroying a collection leaves its projects" do
    assert_difference -> { CollectionMembership.count }, -2 do
      collections(:one).destroy!
    end
    assert Project.exists?(projects(:one).id)
  end

  test "destroying a project removes it from collections" do
    projects(:slides).destroy!
    assert_equal [ projects(:one) ], collections(:one).reload.projects.to_a
  end

  test "transferring ownership removes the project from every collection" do
    collections(:public_one).collection_memberships.create!(project: projects(:one))

    assert projects(:one).transfer_ownership_to!(users(:two))
    assert_empty projects(:one).reload.collections
    assert_equal [ projects(:slides) ], collections(:one).reload.projects.to_a
  end

  test "other updates leave collections alone" do
    projects(:one).update!(title: "Renamed")
    assert_includes projects(:one).reload.collections, collections(:one)
  end
end
