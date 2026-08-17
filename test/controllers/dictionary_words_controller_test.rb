require "test_helper"

class DictionaryWordsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    sign_in users(:one)
  end

  def add(word, project: @project)
    post project_dictionary_words_url(project), params: { word: word }, as: :json
  end

  test "adds a word to the project" do
    add "Cauchy"
    assert_response :no_content
    assert_equal [ "Cauchy" ], @project.reload.dictionary_words
  end

  test "re-adding a word is a no-op rather than an error" do
    add "Cauchy"
    add "cauchy"
    assert_response :no_content
    assert_equal [ "Cauchy" ], @project.reload.dictionary_words
  end

  test "rejects something that is not a word" do
    add "sec-intro-3"
    assert_response :unprocessable_entity
    assert_empty @project.reload.dictionary_words
  end

  test "a collaborator can teach the dictionary, an outsider cannot" do
    sign_in users(:two) # accepted collaborator on project one
    add "Erdos"
    assert_response :no_content

    sign_in users(:subscribed)
    add "Interloper"
    assert_response :forbidden
    assert_equal [ "Erdos" ], @project.reload.dictionary_words
  end

  test "the editor reads the words back with the project" do
    add "Cauchy"

    get project_url(@project, format: :json)
    assert_response :success
    assert_equal [ "Cauchy" ], response.parsed_body["dictionary_words"]
  end
end
