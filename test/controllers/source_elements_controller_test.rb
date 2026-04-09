require "test_helper"

class SourceElementsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one)
    post session_path, params: { email: @user.email, password: "password" }
  end

  # --- INDEX ---

  test "index returns tree of source elements as JSON" do
    get project_source_elements_url(@project), as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert_instance_of Array, json
    assert json.any?
    first = json.first
    assert_equal "section", first["element_type"]
  end

  # --- SHOW ---

  test "show returns a single source element" do
    element = source_elements(:section_one)
    get project_source_element_url(@project, element), as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert_equal element.id, json["id"]
    assert_equal "section", json["element_type"]
    assert_equal "Hello", json["title"]
  end

  # --- CREATE ---

  test "create adds a new source element" do
    assert_difference("SourceElement.count") do
      post project_source_elements_url(@project), params: {
        source_element: {
          element_type: "section",
          title: "New Section",
          source: "<p>New content</p>",
          position: 10
        }
      }, as: :json
    end
    assert_response :created

    json = JSON.parse(response.body)
    assert_equal "New Section", json["title"]
    assert_equal @project.id, json["project_id"]
  end

  test "create with invalid element_type returns error" do
    post project_source_elements_url(@project), params: {
      source_element: { element_type: "invalid", position: 0 }
    }, as: :json
    assert_response :unprocessable_entity
  end

  # --- UPDATE ---

  test "update modifies source element via JSON (auto-save)" do
    element = source_elements(:section_one)
    patch project_source_element_url(@project, element), params: {
      source_element: { source: "<p>Updated content</p>" }
    }, as: :json
    assert_response :ok

    element.reload
    assert_equal "<p>Updated content</p>", element.source
  end

  test "update via HTML reassembles and redirects to project" do
    element = source_elements(:section_one)
    stub_build_server do
      patch project_source_element_url(@project, element), params: {
        source_element: { source: "<p>Built content</p>" }
      }
    end
    assert_redirected_to @project

    element.reload
    assert_equal "<p>Built content</p>", element.source
    # Project source should now contain the assembled document
    @project.reload
    assert_includes @project.source, "<p>Built content</p>"
  end

  # --- DESTROY ---

  test "destroy removes source element" do
    element = source_elements(:section_one)
    assert_difference("SourceElement.count", -1) do
      delete project_source_element_url(@project, element), as: :json
    end
    assert_response :no_content
  end

  # --- MOVE ---

  test "move reparents an element" do
    # Use project two which has a chapter with children
    user_two = users(:two)
    post session_path, params: { email: user_two.email, password: "password" }
    project_two = projects(:two)

    section = source_elements(:section_two_a)
    assert_equal source_elements(:chapter_two).id, section.parent_id

    # Move to root level
    patch move_project_source_element_url(project_two, section), params: {
      parent_id: nil, position: 99
    }, as: :json
    assert_response :ok

    section.reload
    assert_nil section.parent_id
    assert_equal 99, section.position
  end

  # --- REORDER ---

  test "reorder updates positions" do
    user_two = users(:two)
    post session_path, params: { email: user_two.email, password: "password" }
    project_two = projects(:two)

    a = source_elements(:section_two_a)
    b = source_elements(:section_two_b)

    patch reorder_project_source_elements_url(project_two), params: {
      order: [
        { id: a.id, position: 5 },
        { id: b.id, position: 3 }
      ]
    }, as: :json
    assert_response :ok

    assert_equal 5, a.reload.position
    assert_equal 3, b.reload.position
  end

  # --- AUTHORIZATION ---

  test "cannot access another user's project elements" do
    other_project = projects(:two)
    get project_source_elements_url(other_project), as: :json
    assert_response :forbidden
  end
end
