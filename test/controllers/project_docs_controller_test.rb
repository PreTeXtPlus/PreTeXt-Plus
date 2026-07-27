require "test_helper"

class ProjectDocsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    sign_in users(:one)
  end

  def b64(bytes)
    Base64.strict_encode64(bytes)
  end

  test "show reports an unseeded doc" do
    get doc_project_url(@project)
    assert_response :success
    body = response.parsed_body
    assert_equal false, body["seeded"]
    assert_nil body["snapshot"]
    assert_equal [], body["updates"]
  end

  test "seed creates the doc once and returns conflict on the race loser" do
    post seed_doc_project_url(@project), params: { snapshot: b64("seed-a") }, as: :json
    assert_response :created
    assert_equal "seed-a", @project.reload.project_doc.snapshot

    post seed_doc_project_url(@project), params: { snapshot: b64("seed-b") }, as: :json
    assert_response :conflict
    assert_equal "seed-a", @project.reload.project_doc.snapshot
  end

  test "show returns snapshot plus appended updates in order" do
    @project.create_project_doc!(snapshot: "snap")
    first = @project.project_doc_updates.create!(payload: "u1")
    second = @project.project_doc_updates.create!(payload: "u2")

    get doc_project_url(@project)
    assert_response :success
    body = response.parsed_body
    assert body["seeded"]
    assert_equal b64("snap"), body["snapshot"]
    assert_equal [ first.id, second.id ], body["updates"].map { |u| u["id"] }
    assert_equal [ b64("u1"), b64("u2") ], body["updates"].map { |u| u["payload"] }
  end

  test "compaction replaces the snapshot and deletes only rows through the given id" do
    @project.create_project_doc!(snapshot: "old")
    merged = @project.project_doc_updates.create!(payload: "merged")
    raced = @project.project_doc_updates.create!(payload: "raced-in-later")

    put doc_project_url(@project), params: { snapshot: b64("new"), through_update_id: merged.id }, as: :json
    assert_response :no_content

    assert_equal "new", @project.reload.project_doc.snapshot
    assert_equal [ raced.id ], @project.project_doc_updates.pluck(:id)
  end

  test "compaction on an unseeded doc conflicts" do
    put doc_project_url(@project), params: { snapshot: b64("x"), through_update_id: 1 }, as: :json
    assert_response :conflict
  end

  test "collaborator can use the doc endpoints, outsider cannot" do
    sign_in users(:two) # accepted collaborator on project one
    get doc_project_url(@project)
    assert_response :success

    sign_in users(:subscribed)
    get doc_project_url(@project), headers: { "Accept" => "application/json" }
    assert_response :forbidden
  end

  test "removing the last collaboration resets the doc" do
    @project.create_project_doc!(snapshot: "snap")
    @project.project_doc_updates.create!(payload: "u1")

    collaborations(:accepted).destroy!

    assert_nil @project.reload.project_doc
    assert_equal 0, @project.project_doc_updates.count
  end
end
