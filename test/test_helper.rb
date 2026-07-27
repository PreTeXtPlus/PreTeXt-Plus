ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "minitest/mock"
require_relative "test_helpers/session_test_helper"

# Fake stand-ins for the encrypted full_build/preview_build credentials, so the test
# suite never needs the production RAILS_MASTER_KEY (in CI or otherwise). Nothing here
# is a real secret -- the values only need to look like a host/token so the code under
# test (URI building, HMAC signing) has something to work with.
#
# Overriding #dig directly (rather than #config) sidesteps EncryptedConfiguration's own
# memoization of #options, which may already be cached by the time this runs.
TEST_CREDENTIALS = {
  full_build: {
    host: "build-full.test",
    token: "test-full-build-token",
    webhook_secret: "test-webhook-secret"
  },
  preview_build: {
    host: "preview-build.test",
    token: "test-preview-build-token"
  }
}.freeze

Rails.application.credentials.define_singleton_method(:dig) do |*keys|
  TEST_CREDENTIALS.dig(*keys)
end

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end
