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

    fake_http = Object.new
    fake_http.define_singleton_method(:request) { |_req| fake_response }

    if raise_error
      Net::HTTP.stub(:start, proc { |*_args, &_blk| raise raise_error }, &test_block)
    else
      Net::HTTP.stub(:start, proc { |*_args, &http_block| http_block.call(fake_http) }, &test_block)
    end
  end
end

module SessionTestHelper
  def sign_in_as(user)
    Current.session = user.sessions.create!

    ActionDispatch::TestRequest.create.cookie_jar.tap do |cookie_jar|
      cookie_jar.signed[:session_id] = Current.session.id
      cookies["session_id"] = cookie_jar[:session_id]
    end
  end

  def sign_out
    Current.session&.destroy!
    cookies.delete("session_id")
  end
end

ActiveSupport.on_load(:active_support_test_case) do
  include BuildServerHelper
end

ActiveSupport.on_load(:action_dispatch_integration_test) do
  include SessionTestHelper
end
