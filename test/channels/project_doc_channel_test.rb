require "test_helper"

class ProjectDocChannelTest < ActionCable::Channel::TestCase
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

  test "doc_update persists the payload and broadcasts it" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    payload = Base64.strict_encode64("yjs-update-bytes")
    assert_difference("ProjectDocUpdate.count") do
      perform :doc_update, payload: payload, sender: "tab-1"
    end

    row = project.project_doc_updates.last
    assert_equal "yjs-update-bytes", row.payload

    message = JSON.parse(broadcasts(ProjectDocChannel.broadcasting_for(project)).last)
    assert_equal "update", message["type"]
    assert_equal row.id, message["id"]
    assert_equal payload, message["payload"]
    assert_equal "tab-1", message["sender"]
  end

  test "an oversized update is persisted but announced rather than sent" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    big = Base64.strict_encode64("x" * ProjectDocChannel::MAX_BROADCAST_BYTES)
    assert_operator big.bytesize, :>, ProjectDocChannel::MAX_BROADCAST_BYTES

    assert_difference("ProjectDocUpdate.count") do
      perform :doc_update, payload: big, sender: "tab-1"
    end

    message = JSON.parse(broadcasts(ProjectDocChannel.broadcasting_for(project)).last)
    assert_equal "resync", message["type"]
    assert_nil message["payload"], "the payload must not ride the cable"
    assert_equal project.project_doc_updates.last.id, message["id"]
    # Small enough to keep every adapter, including postgres LISTEN/NOTIFY, happy.
    assert_operator message.to_json.bytesize, :<, 8_000
  end

  test "an oversized awareness update is dropped rather than raising" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    before = broadcasts(ProjectDocChannel.broadcasting_for(project)).size
    perform :awareness, payload: Base64.strict_encode64("y" * ProjectDocChannel::MAX_BROADCAST_BYTES), sender: "tab-1"

    assert_equal before, broadcasts(ProjectDocChannel.broadcasting_for(project)).size
  end

  test "awareness broadcasts without persisting" do
    project = projects(:one)
    stub_connection current_user: users(:one)
    subscribe project_id: project.id

    payload = Base64.strict_encode64("awareness-bytes")
    assert_no_difference("ProjectDocUpdate.count") do
      assert_broadcast_on(ProjectDocChannel.broadcasting_for(project),
                          type: "awareness", payload: payload, sender: "tab-1") do
        perform :awareness, payload: payload, sender: "tab-1"
      end
    end
  end
end
