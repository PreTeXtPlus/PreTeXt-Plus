require "test_helper"

class ProjectDocsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    sign_in users(:one)
  end

  def fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  def b64(bytes)
    Base64.strict_encode64(bytes)
  end

  def stored_source
    doc = Y::Doc.new
    doc.apply_update(ProjectDoc.load_state(ProjectDoc.key_for(@project.reload)))
    JSON.parse(doc.read_map("divisions") || "{}").values.first&.dig("source")
  end

  test "seed creates the document once" do
    post seed_doc_project_url(@project), params: { state: b64(fixture("seed_state")) }, as: :json
    assert_response :created
    assert_includes stored_source, "Fixture Book"
  end

  test "the race loser is told to join rather than seeding again" do
    post seed_doc_project_url(@project), params: { state: b64(fixture("seed_state")) }, as: :json
    assert_response :created

    # Two accepted seeds would not overwrite each other -- the CRDT would merge
    # them as concurrent inserts and every division's text would appear twice.
    assert_no_difference("Y::Document.count") do
      post seed_doc_project_url(@project), params: { state: b64(fixture("rival_state")) }, as: :json
    end
    assert_response :conflict

    assert_includes stored_source, "Fixture Book"
    refute_includes stored_source.to_s, "Rival", "the losing seed must not reach the document"
  end

  test "a collaborator may seed, an outsider may not" do
    sign_in users(:two) # accepted collaborator on project one
    post seed_doc_project_url(@project), params: { state: b64(fixture("seed_state")) }, as: :json
    assert_response :created

    sign_in users(:subscribed)
    post seed_doc_project_url(projects(:one)),
      params: { state: b64(fixture("rival_state")) },
      as: :json
    assert_response :forbidden
  end

  test "removing the last collaboration resets the document" do
    ProjectDoc.seed(@project, fixture("seed_state"))
    ProjectDoc.record(ProjectDoc.key_for(@project), fixture("one_update"))

    collaborations(:accepted).destroy!

    assert_not ProjectDoc.seeded?(@project)
    assert_equal 0, Y::DocumentUpdate.count
  end

  test "destroying a project takes its document with it" do
    ProjectDoc.seed(@project, fixture("seed_state"))
    ProjectDoc.record(ProjectDoc.key_for(@project), fixture("one_update"))

    @project.destroy!

    assert_equal 0, Y::Document.count
    assert_equal 0, Y::DocumentUpdate.count
  end
end
