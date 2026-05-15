require "test_helper"

class ProjectBuildStateTest < ActiveSupport::TestCase
  test "valid states are recognized" do
    assert ProjectBuildState.valid_state?("pending")
    assert ProjectBuildState.valid_state?("queued")
    assert ProjectBuildState.valid_state?("running")
    assert ProjectBuildState.valid_state?("succeeded")
    assert ProjectBuildState.valid_state?("failed")
  end

  test "invalid states are rejected" do
    assert_not ProjectBuildState.valid_state?("done")
    assert_not ProjectBuildState.valid_state?(nil)
  end

  test "allows only expected transitions" do
    assert ProjectBuildState.allowed_transition?(from: "pending", to: "queued")
    assert ProjectBuildState.allowed_transition?(from: "queued", to: "running")
    assert ProjectBuildState.allowed_transition?(from: "running", to: "succeeded")
    assert ProjectBuildState.allowed_transition?(from: "running", to: "failed")
    assert ProjectBuildState.allowed_transition?(from: "failed", to: "queued")
  end

  test "rejects invalid transitions" do
    assert_not ProjectBuildState.allowed_transition?(from: "pending", to: "running")
    assert_not ProjectBuildState.allowed_transition?(from: "succeeded", to: "running")
    assert_not ProjectBuildState.allowed_transition?(from: "queued", to: "succeeded")
  end
end