require "net/http"
require "uri"

module BuildServerHelper
  # Stubs the external PreTeXt build server call so tests don't need
  # BUILD_HOST / BUILD_TOKEN env vars set.
  def stub_build_server(&block)
    fake_response = Struct.new(:body).new("<html><body>stub</body></html>")
    Net::HTTP.stub(:post_form, fake_response, &block)
  end

  # Stubs the Net::HTTP.start-based preview build call used by ProjectsController#preview.
  # Yields a fake successful HTTP response with the given body by default.
  # Pass `raise_error:` to simulate a network failure instead.
  def stub_preview_server(body: "<html><body>stub preview</body></html>", raise_error: nil, &test_block)
    fake_response = Struct.new(:body).new(body)
    fake_response.define_singleton_method(:is_a?) { |klass| klass == Net::HTTPSuccess }

    if raise_error
      fake_response.define_singleton_method(:code) { "500" }
    else
      fake_response.define_singleton_method(:code) { "200" }
    end

    fake_http = Object.new
    fake_http.define_singleton_method(:request) { |_req| fake_response }

    if raise_error
      Net::HTTP.stub(:start, proc { |*_args, &_blk| raise raise_error }, &test_block)
    else
      Net::HTTP.stub(:start, proc { |*_args, &http_block| http_block.call(fake_http) }, &test_block)
    end
  end
end

ActiveSupport.on_load(:active_support_test_case) do
  include BuildServerHelper
end

ActiveSupport.on_load(:action_dispatch_integration_test) do
  include Devise::Test::IntegrationHelpers
end
