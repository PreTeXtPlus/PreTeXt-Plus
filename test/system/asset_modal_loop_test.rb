require "application_system_test_case"

class AssetModalLoopTest < ApplicationSystemTestCase
  test "asset manager modal opens without looping requests" do
    user = User.find_by(email: "one@example.com")
    project = user.projects.first

    request_log = []
    subscriber = ActiveSupport::Notifications.subscribe("process_action.action_controller") do |*args|
      event = ActiveSupport::Notifications::Event.new(*args)
      request_log << [ event.time, event.payload[:method], event.payload[:path] ]
    end

    visit new_user_session_path
    fill_in "user_email", with: user.email
    fill_in "user_password", with: "password123"
    click_button "Sign in"

    visit edit_project_path(project)

    assert_selector "button.pretext-plus-editor__toc-assets-btn", text: "Manage Assets", wait: 20
    find("button.pretext-plus-editor__toc-assets-btn", text: "Manage Assets").click

    assert_selector "[aria-label='Asset manager']", wait: 10

    sleep 6

    library_requests = request_log.count { |_, _, path| path.to_s.start_with?("/library") }
    puts "total requests during modal-open window: #{request_log.size}, library: #{library_requests}"
    t0 = request_log.first&.first
    request_log.first(20).each { |t, m, p| puts "  +#{(t - t0).round(3)}s #{m} #{p}" }
    puts "  ... (#{request_log.size - 20} more)" if request_log.size > 20
    take_screenshot
    assert library_requests < 5,
      "Expected only a handful of /library requests, got #{library_requests} -- looks like a loop"
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber) if subscriber
  end
end
