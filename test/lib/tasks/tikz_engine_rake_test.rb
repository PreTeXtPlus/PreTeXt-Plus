require "test_helper"
require "rake"

class TikzEngineRakeTest < ActiveSupport::TestCase
  setup do
    Rails.application.load_tasks unless Rake::Task.task_defined?("tikz_engine:fetch")
  end

  # A deploy that lost this would still succeed, and TikZ assets would stop rendering live.
  test "every deploy fetches the engine" do
    assert_includes Rake::Task["assets:precompile"].prerequisites, "tikz_engine:fetch"
  end

  test "a test run does not need the network" do
    assert_not_includes Rake::Task["test:prepare"].prerequisites, "tikz_engine:fetch"
  end
end
