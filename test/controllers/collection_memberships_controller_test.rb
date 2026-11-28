require "test_helper"

class CollectionMembershipsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @collection = collections(:one) # slides (0), one (1)
    sign_in @user
  end

  test "owner adds one of their projects to the end" do
    post collection_memberships_url(collections(:public_one)), params: { project_id: projects(:slides).id }
    assert_redirected_to collections(:public_one)
    assert_equal [ projects(:slides) ], collections(:public_one).projects.to_a
  end

  test "a project the author does not own is not added" do
    assert_no_difference -> { CollectionMembership.count } do
      post collection_memberships_url(@collection), params: { project_id: projects(:two).id }
    end
    assert_redirected_to @collection
    assert flash[:alert].present?
  end

  test "owner removes a project" do
    delete collection_membership_url(@collection, collection_memberships(:one_slides))
    assert_redirected_to @collection
    assert_equal [ projects(:one) ], @collection.reload.projects.to_a
  end

  test "move up and down, and nothing past either end" do
    patch move_collection_membership_url(@collection, collection_memberships(:one_one), direction: "up")
    assert_redirected_to @collection
    assert_equal [ projects(:one), projects(:slides) ], @collection.reload.projects.to_a

    patch move_collection_membership_url(@collection, collection_memberships(:one_one), direction: "up")
    assert_equal [ projects(:one), projects(:slides) ], @collection.reload.projects.to_a

    patch move_collection_membership_url(@collection, collection_memberships(:one_one), direction: "down")
    assert_equal [ projects(:slides), projects(:one) ], @collection.reload.projects.to_a
  end

  test "an unknown direction is rejected" do
    patch move_collection_membership_url(@collection, collection_memberships(:one_one), direction: "sideways")
    assert_response :bad_request
  end

  test "others cannot change a collection, even a visible one" do
    @collection.update!(visibility: :public)
    sign_in users(:two)
    get projects_url # Devise's test sign_in only sticks once a request succeeds

    assert_no_difference -> { CollectionMembership.count } do
      post collection_memberships_url(@collection), params: { project_id: projects(:two).id }
      assert_response :not_found
      delete collection_membership_url(@collection, collection_memberships(:one_slides))
      assert_response :not_found
    end
    patch move_collection_membership_url(@collection, collection_memberships(:one_one), direction: "up")
    assert_response :not_found
    assert_equal [ projects(:slides), projects(:one) ], @collection.reload.projects.to_a
  end
end
