require "test_helper"

class ProjectDocsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    sign_in users(:one)
  end

  def b64(bytes)
    Base64.strict_encode64(bytes)
  end

  def with_cap(size)
    original = ProjectDocsController::MAX_MERGED_IDS
    ProjectDocsController.send(:remove_const, :MAX_MERGED_IDS)
    ProjectDocsController.const_set(:MAX_MERGED_IDS, size)
    yield
  ensure
    ProjectDocsController.send(:remove_const, :MAX_MERGED_IDS)
    ProjectDocsController.const_set(:MAX_MERGED_IDS, original)
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
    # The winner is told which snapshot version its seed became, so it starts
    # level with the log instead of fetching back what it just sent.
    assert_equal @project.project_doc.updated_at.utc.iso8601(6),
      response.parsed_body["snapshot_version"]

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

  test "compaction replaces the snapshot and deletes exactly the rows it names" do
    @project.create_project_doc!(snapshot: "old")
    merged = @project.project_doc_updates.create!(payload: "merged")
    raced = @project.project_doc_updates.create!(payload: "raced-in-later")

    put doc_project_url(@project),
      params: { snapshot: b64("new"), merged_update_ids: [ merged.id ] }, as: :json
    assert_response :no_content

    assert_equal "new", @project.reload.project_doc.snapshot
    assert_equal [ raced.id ], @project.project_doc_updates.pluck(:id)
  end

  test "compaction keeps a row the client skipped, even below the ids it claims" do
    @project.create_project_doc!(snapshot: "old")
    skipped = @project.project_doc_updates.create!(payload: "never-read")
    merged = @project.project_doc_updates.create!(payload: "merged")

    # `skipped` has the lower id, so a "delete everything through N" claim would
    # take it -- and it is the only copy of that update, since the snapshot being
    # written was built without it. A client can end up here innocently: ids come
    # from a sequence that hands them out before the commits a reader needs to
    # see, so a read ordered by id can pass a row over. Naming ids one by one is
    # what makes the claim checkable.
    put doc_project_url(@project),
      params: { snapshot: b64("new"), merged_update_ids: [ merged.id ] }, as: :json
    assert_response :no_content

    assert_equal [ skipped.id ], @project.project_doc_updates.pluck(:id)
  end

  test "compaction with nothing claimed refreshes the snapshot and keeps the log" do
    @project.create_project_doc!(snapshot: "old")
    row = @project.project_doc_updates.create!(payload: "u1")

    put doc_project_url(@project), params: { snapshot: b64("new") }, as: :json
    assert_response :no_content

    assert_equal "new", @project.reload.project_doc.snapshot
    assert_equal [ row.id ], @project.project_doc_updates.pluck(:id)
  end

  test "compaction ignores claimed ids beyond the cap rather than refusing them" do
    @project.create_project_doc!(snapshot: "old")
    rows = 3.times.map { |i| @project.project_doc_updates.create!(payload: "u#{i}") }

    # A shorter claim only ever means fewer deletions, so truncating is safe and
    # the remainder is collected next time round.
    with_cap(2) do
      put doc_project_url(@project),
        params: { snapshot: b64("new"), merged_update_ids: rows.map(&:id) }, as: :json
    end
    assert_response :no_content

    assert_equal [ rows.last.id ], @project.project_doc_updates.pluck(:id)
  end

  test "status reports what is persisted without any of the payloads" do
    @project.create_project_doc!(snapshot: "snap")
    first = @project.project_doc_updates.create!(payload: "u1")
    second = @project.project_doc_updates.create!(payload: "u2")

    get doc_status_project_url(@project)
    assert_response :success
    body = response.parsed_body

    assert body["seeded"]
    assert_equal [ first.id, second.id ], body["update_ids"]
    assert_equal @project.project_doc.updated_at.utc.iso8601(6), body["snapshot_version"]
    # The point of the endpoint: a client can ask this on every save because the
    # answer does not carry the document.
    assert_not response.body.include?(b64("snap"))
    assert_not response.body.include?(b64("u1"))
  end

  test "status reports an unseeded doc" do
    get doc_status_project_url(@project)
    assert_response :success
    body = response.parsed_body

    assert_equal false, body["seeded"]
    assert_nil body["snapshot_version"]
    assert_equal [], body["update_ids"]
  end

  test "status only counts the project it is asked about" do
    @project.create_project_doc!(snapshot: "snap")
    mine = @project.project_doc_updates.create!(payload: "mine")
    projects(:two).project_doc_updates.create!(payload: "theirs")

    get doc_status_project_url(@project)

    assert_equal [ mine.id ], response.parsed_body["update_ids"]
  end

  test "show names the snapshot version a client is adopting" do
    @project.create_project_doc!(snapshot: "snap")

    get doc_project_url(@project)

    assert_equal @project.project_doc.updated_at.utc.iso8601(6),
      response.parsed_body["snapshot_version"]
  end

  test "compaction gives the snapshot a version a client can tell apart" do
    @project.create_project_doc!(snapshot: "old")
    get doc_status_project_url(@project)
    before = response.parsed_body["snapshot_version"]

    travel 1.minute do
      put doc_project_url(@project), params: { snapshot: b64("new") }, as: :json
      get doc_status_project_url(@project)
    end

    # Clients compare these as strings, so a compaction has to move it forward.
    assert_operator response.parsed_body["snapshot_version"], :>, before
  end

  test "compaction on an unseeded doc conflicts" do
    put doc_project_url(@project), params: { snapshot: b64("x"), through_update_id: 1 }, as: :json
    assert_response :conflict
  end

  test "collaborator can use the doc endpoints, outsider cannot" do
    sign_in users(:two) # accepted collaborator on project one
    get doc_project_url(@project)
    assert_response :success
    get doc_status_project_url(@project)
    assert_response :success

    sign_in users(:subscribed)
    get doc_project_url(@project), headers: { "Accept" => "application/json" }
    assert_response :forbidden
    get doc_status_project_url(@project), headers: { "Accept" => "application/json" }
    assert_response :forbidden
  end

  test "compaction only deletes rows belonging to the project it is called on" do
    other = projects(:two)
    @project.create_project_doc!(snapshot: "old")
    mine = @project.project_doc_updates.create!(payload: "mine")
    theirs = other.project_doc_updates.create!(payload: "theirs")

    put doc_project_url(@project),
      params: { snapshot: b64("new"), merged_update_ids: [ mine.id, theirs.id ] }, as: :json
    assert_response :no_content

    assert_empty @project.project_doc_updates.pluck(:id)
    assert_equal [ theirs.id ], other.project_doc_updates.pluck(:id)
  end

  test "removing the last collaboration resets the doc" do
    @project.create_project_doc!(snapshot: "snap")
    @project.project_doc_updates.create!(payload: "u1")

    collaborations(:accepted).destroy!

    assert_nil @project.reload.project_doc
    assert_equal 0, @project.project_doc_updates.count
  end
end
