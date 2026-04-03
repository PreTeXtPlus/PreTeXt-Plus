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

  # Stubs the external PreTeXt build server call so tests don't need
  # BUILD_HOST / BUILD_TOKEN env vars set.
  def stub_build_server(&block)
    fake_response = Struct.new(:body).new("<html><body>stub</body></html>")
    Net::HTTP.stub(:post_form, fake_response, &block)
  end
end

ActiveSupport.on_load(:action_dispatch_integration_test) do
  include SessionTestHelper
end
