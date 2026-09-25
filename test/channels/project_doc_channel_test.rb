require "test_helper"

class ProjectDocChannelTest < ActionCable::Channel::TestCase
  # Real Yjs bytes, produced through the editor's own schema by
  # script/generate-collab-fixtures.mjs. Ruby cannot write a Y::Doc, and a
  # hand-rolled byte string would test the frame dispatch while telling us
  # nothing about whether a real document survives the round trip.
  def fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  def frame(bytes)
    Base64.strict_encode64(bytes)
  end

  def stream_for(project)
    "yrby:#{ProjectDoc.key_for(project)}"
  end

  test "owner and collaborator can subscribe" do
    stub_connection current_user: users(:one)
    subscribe project_id: projects(:one).id
    assert subscription.confirmed?

    stub_connection current_user: users(:two) # accepted collaborator
    subscribe project_id: projects(:one).id
    assert subscription.confirmed?
  end

  test "non-collaborator and missing project are rejected" do
    stub_connection current_user: users(:subscribed)
    subscribe project_id: projects(:one).id
    assert subscription.rejected?

    stub_connection current_user: users(:one)
    subscribe project_id: SecureRandom.uuid
    assert subscription.rejected?
  end

  test "subscribing opens the handshake with the server's state vector" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    assert_has_stream stream_for(project)
    opening = transmissions.last
    assert_equal 1, Y.message_kind(Base64.strict_decode64(opening["update"])),
      "the server opens with SyncStep1, which is what asks the joining client " \
      "for anything the server does not have"
  end

  test "a document update is recorded before it is relayed, then acked" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    assert_difference("Y::DocumentUpdate.count", 1) do
      perform :receive, update: frame(Y.wrap_update(fixture("seed_state"))), id: 7
    end

    # The ack is the client's only evidence of delivery, and it is emitted only
    # after on_change returned -- so hearing it is proof of persistence rather
    # than proof that a socket accepted some bytes.
    assert_equal 7, transmissions.last["ack"]

    relayed = broadcasts(stream_for(project)).map { |m| JSON.parse(m) }
    assert relayed.any? { |m| m["update"].present? }, "the update is relayed to peers"
  end

  test "the stored document is the real editor document, readable from Ruby" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    perform :receive, update: frame(Y.wrap_update(fixture("seed_state"))), id: 1
    perform :receive, update: frame(Y.wrap_update(fixture("one_update"))), id: 2

    doc = Y::Doc.new
    doc.apply_update(ProjectDoc.load_state(ProjectDoc.key_for(project)))
    divisions = JSON.parse(doc.read_map("divisions") || "{}")

    assert_equal 1, divisions.size
    source = divisions.values.first["source"]
    assert_includes source, "Fixture Book"
    assert_includes source, 'xmlns:plus="https://pretext.plus"',
      "the incremental update integrated into the stored document"
  end

  test "an update whose recording fails is neither acked nor relayed" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id
    before = broadcasts(stream_for(project)).size

    ProjectDoc.stub(:record, ->(*) { raise ActiveRecord::StatementInvalid, "no" }) do
      assert_no_difference("Y::DocumentUpdate.count") do
        assert_raises(ActiveRecord::StatementInvalid) do
          perform :receive, update: frame(Y.wrap_update(fixture("seed_state"))), id: 9
        end
      end
    end

    assert_equal before, broadcasts(stream_for(project)).size
    assert transmissions.none? { |m| m["ack"] == 9 },
      "an unrecorded update must not be acknowledged; the client still holds it"
  end

  test "awareness is relayed without being stored" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    # A real presence frame. The server validates the payload rather than
    # trusting the tag, but never stores it: presence outlives nobody.
    awareness = fixture("awareness_frame")
    assert_equal 3, Y.message_kind(awareness)

    assert_no_difference([ "Y::DocumentUpdate.count", "Y::Document.count" ]) do
      perform :receive, update: frame(awareness)
    end
    assert broadcasts(stream_for(project)).any? { |m| JSON.parse(m)["update"] == frame(awareness) }
  end

  test "a frame past the size cap is dropped rather than stored" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    oversized = Y.wrap_update(fixture("seed_state")) + ("x" * ProjectDocChannel.max_frame_bytes)
    assert_no_difference("Y::DocumentUpdate.count") do
      perform :receive, update: frame(oversized), id: 4
    end
    assert transmissions.none? { |m| m["ack"] == 4 }
  end
end
