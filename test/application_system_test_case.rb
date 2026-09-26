require "test_helper"

# Turbo's morph-based refreshes (turbo-frame refresh="morph",
# session.refresh(method: "morph") in stream_reconnect_controller.js) can
# replace a DOM node between the moment Selenium resolves it and the moment
# it acts on or re-inspects it. Chrome's DevTools Protocol reports that race
# as a generic Selenium::WebDriver::Error::UnknownError wrapping an
# "unhandled inspector error", rather than as the StaleElementReferenceError
# Capybara already knows to retry on (see
# Capybara::Selenium::Driver#invalid_element_errors). Teach Capybara's
# existing wait-and-retry loop (Capybara::Node::Base#synchronize) to treat
# this the same way, instead of failing the test outright on a transient
# race.
#
# Verified against capybara 3.40.0's private catch_error?/
# invalid_element_errors internals. If system tests stop retrying this error
# after a Capybara upgrade, re-check those methods for signature changes.
module RetriesTransientInspectorErrors
  INSPECTOR_RACE_ERROR = /unhandled inspector error/

  def catch_error?(error, errors = nil)
    return true if error.is_a?(Selenium::WebDriver::Error::UnknownError) &&
      error.message.match?(INSPECTOR_RACE_ERROR)

    super
  end
end
Capybara::Node::Base.prepend(RetriesTransientInspectorErrors)

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  if ENV["CAPYBARA_SERVER_PORT"]
    served_by host: "rails-app", port: ENV["CAPYBARA_SERVER_PORT"]

    driven_by :selenium, using: :headless_chrome, screen_size: [ 1400, 1400 ], options: {
      browser: :remote,
      url: "http://#{ENV["SELENIUM_HOST"]}:4444"
    }
  else
    driven_by :selenium, using: :headless_chrome, screen_size: [ 1400, 1400 ]
  end

  # Show a project-explorer view (:toc, :snippets, :assets, :find) in the editor.
  # Clicking the icon of the view that's already open collapses the explorer,
  # so only click when it isn't the pressed one.
  def open_explorer_view(view)
    tab = find("button[data-testid='explorer-tab-#{view}']", wait: 20)
    tab.click unless tab["aria-pressed"] == "true"
    assert_selector "button[data-testid='explorer-tab-#{view}'][aria-pressed='true']"
  end
end
