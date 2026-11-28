require "test_helper"

class CollectionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @collection = collections(:one) # private; slides then one
  end

  test "index lists only my collections, most recently updated first" do
    users(:two).collections.create!(name: "Not mine")
    collections(:public_one).touch
    sign_in @user

    get collections_url

    assert_response :success
    assert_includes response.body, "My Public Collection"
    assert_not_includes response.body, "Not mine"
    assert_operator response.body.index("My Public Collection"), :<, response.body.index("My Collection<")
    assert_includes response.body, "2 projects"
  end

  test "owner sees projects in order with reorder controls" do
    sign_in @user
    get collection_url(@collection)

    assert_response :success
    assert_operator response.body.index(projects(:slides).title), :<, response.body.index(projects(:one).title)
    assert_select "form[action=?]", move_collection_membership_path(@collection, collection_memberships(:one_slides), direction: "up") do
      assert_select "button[disabled]"
    end
    # Both of the owner's projects are already in it...
    assert_select "form[action=?]", collection_memberships_path(@collection), count: 0
    assert_includes response.body, "Every project you own is already in this collection."

    # ...so the add form appears once one is taken out.
    collection_memberships(:one_one).destroy!
    get collection_url(@collection)
    assert_select "form[action=?]", collection_memberships_path(@collection) do
      assert_select "option[value=?]", projects(:one).id
    end
  end

  test "someone else's collection is a 404, whatever its visibility" do
    sign_in users(:two)
    get projects_url # Devise's test sign_in only sticks once a request succeeds
    Collection.visibilities.each_key do |visibility|
      @collection.update!(visibility: visibility)
      get collection_url(@collection)
      assert_response :not_found, visibility
    end
  end

  test "an admin gets a 404 for someone else's collection too" do
    users(:two).update!(admin: true)
    sign_in users(:two)
    get collection_url(collections(:public_one))
    assert_response :not_found
  end

  test "create derives a slug and opens the new collection" do
    sign_in @user
    assert_difference -> { @user.collections.count } do
      post collections_url, params: { collection: { name: "Calculus Sequence", visibility: "public" } }
    end
    collection = @user.collections.find_by!(name: "Calculus Sequence")
    assert_equal "calculus-sequence", collection.slug
    assert collection.public_visibility?
    assert_redirected_to collection
  end

  test "create from a project files it and returns to the project" do
    sign_in @user
    post collections_url, params: { project_id: projects(:one).id, collection: { name: "From project" } }

    collection = @user.collections.find_by!(name: "From project")
    assert_equal [ projects(:one) ], collection.projects.to_a
    assert_redirected_to projects(:one)
  end

  test "create ignores a project the author does not own" do
    sign_in @user
    post collections_url, params: { project_id: projects(:two).id, collection: { name: "Sneaky" } }

    collection = @user.collections.find_by!(name: "Sneaky")
    assert_empty collection.projects
    assert_redirected_to collection
  end

  test "new from a project names it" do
    sign_in @user
    get new_collection_url(project_id: projects(:one).id)
    assert_select "input[type=hidden][name=project_id][value=?]", projects(:one).id
  end

  test "invalid create re-renders the form" do
    sign_in @user
    assert_no_difference -> { Collection.count } do
      post collections_url, params: { collection: { name: "", slug: "Bad Slug!" } }
    end
    assert_response :unprocessable_entity
    assert_select "li", text: /Name can't be blank/
  end

  test "owner updates and deletes a collection; projects survive" do
    sign_in @user
    patch collection_url(@collection), params: { collection: { name: "Renamed", slug: "renamed" } }
    assert_redirected_to @collection
    assert_equal "renamed", @collection.reload.slug

    assert_difference -> { Collection.count }, -1 do
      delete collection_url(@collection)
    end
    assert_redirected_to collections_path
    assert Project.exists?(projects(:one).id)
  end

  test "nobody else edits, updates or deletes a collection, even a public one" do
    sign_in users(:two)
    get projects_url # Devise's test sign_in only sticks once a request succeeds
    target = collections(:public_one)

    get edit_collection_url(target)
    assert_response :not_found
    patch collection_url(target), params: { collection: { name: "Hijacked" } }
    assert_response :not_found
    assert_no_difference -> { Collection.count } do
      delete collection_url(target)
    end
    assert_response :not_found
    assert_equal "My Public Collection", target.reload.name
  end
end
