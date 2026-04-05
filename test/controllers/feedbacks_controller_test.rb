require "test_helper"

class FeedbacksControllerTest < ActionDispatch::IntegrationTest
  test "create sends feedback email with message" do
    assert_enqueued_emails 1 do
      post feedbacks_path, params: { message: "This is great!" }, as: :json
    end
    assert_response :success
    assert_equal true, response.parsed_body["success"]
  end

  test "create returns error when message is blank" do
    assert_enqueued_emails 0 do
      post feedbacks_path, params: { message: "  " }, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal "Message is required.", response.parsed_body["error"]
  end

  test "create accepts optional email with message" do
    assert_enqueued_emails 1 do
      post feedbacks_path, params: { message: "Test", email: "user@example.com" }, as: :json
    end
    assert_response :success
  end

  test "create accepts source_content and project_id" do
    assert_enqueued_emails 1 do
      post feedbacks_path, params: {
        message: "Conversion issue",
        source_content: "<pretext>hello</pretext>",
        project_id: "abc-123"
      }, as: :json
    end
    assert_response :success
  end

  test "create works without authentication" do
    assert_enqueued_emails 1 do
      post feedbacks_path, params: { message: "Anonymous feedback" }, as: :json
    end
    assert_response :success
  end
end
