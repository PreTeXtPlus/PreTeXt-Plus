require "test_helper"

class ProjectCollectionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one) # in collections(:one); users(:two) collaborates on it
  end

  test "owner sets exactly the checked collections" do
    sign_in @user
    patch project_collections_url(@project), params: { collection_ids: [ "", collections(:public_one).id ] }

    assert_redirected_to @project
    assert_equal [ collections(:public_one) ], @project.reload.collections.to_a
    # The project that stayed in collections(:one) keeps its place.
    assert_equal [ projects(:slides) ], collections(:one).reload.projects.to_a
  end

  test "unchecking everything removes the project from every collection" do
    sign_in @user
    patch project_collections_url(@project), params: { collection_ids: [ "" ] }
    assert_empty @project.reload.collections
  end

  test "collections that are not the owner's are ignored" do
    theirs = users(:two).collections.create!(name: "Theirs")
    sign_in @user

    patch project_collections_url(@project), params: { collection_ids: [ "", collections(:one).id, theirs.id ] }

    assert_equal [ collections(:one) ], @project.reload.collections.to_a
  end

  test "a collaborator cannot file the project" do
    theirs = users(:two).collections.create!(name: "Theirs")
    sign_in users(:two)

    patch project_collections_url(@project), params: { collection_ids: [ theirs.id ] }

    assert_redirected_to projects_path
    assert_empty theirs.projects
  end
end
