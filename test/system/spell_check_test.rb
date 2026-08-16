require "application_system_test_case"

# The dictionary is the one part of spell checking that spans both halves of the
# app: the checker and its quick fixes live in the editor package, but a word an
# author adds has to reach Rails and come back on the next visit -- otherwise
# every session starts by re-teaching the same vocabulary, and a co-author never
# learns it at all. Both halves are covered on their own (the package's Vitest
# suite; DictionaryWordsControllerTest), so this drives the seam between them.
class SpellCheckTest < ApplicationSystemTestCase
  # Nonsense no dictionary carries, and distinct enough that a stray match
  # elsewhere on the page can't be mistaken for one of ours.
  TAUGHT_WORD = "Qqwerty".freeze
  UNKNOWN_WORD = "Zzyzxx".freeze

  setup do
    @user = users(:one)
    @project = projects(:one)

    visit new_user_session_path
    fill_in "user_email", with: @user.email
    fill_in "user_password", with: "password123"
    click_button "Sign in"
    # Wait for the post-login navigation to land: `visit` doesn't queue behind
    # an in-flight one, so without this the editor page can be replaced by the
    # redirect that was already on its way.
    assert_text "Signed in successfully.", wait: 10
  end

  test "a word added from the editor persists to the project and is trusted next visit" do
    open_editor
    type_in_body TAUGHT_WORD
    # The first pass waits on the Hunspell dictionary being fetched, which is
    # ~650KB of word list, hence the patience here.
    assert_selector ".squiggly-info", wait: 30

    add_to_dictionary TAUGHT_WORD

    # Accepted locally straight away...
    assert_no_selector ".squiggly-info", wait: 10
    # ...and stored on the project, which is what the collaborator sees.
    assert_dictionary_words_eventually [ TAUGHT_WORD ]

    # A fresh session: the word now arrives with the project, so it is never
    # flagged again. The unknown word is the control -- it proves the checker is
    # running in this second editor, so the absence below means "accepted",
    # not "never checked".
    open_editor
    type_in_body UNKNOWN_WORD
    assert_selector ".squiggly-info", wait: 30

    UNKNOWN_WORD.length.times { page.send_keys :backspace }
    page.send_keys TAUGHT_WORD
    assert_no_selector ".squiggly-info", wait: 10
  end

  private

    def open_editor
      visit edit_project_path(@project)
      assert_selector ".monaco-editor", wait: 30
    end

    # Type into the division's body. Click the body text itself, never the
    # `.view-lines` container: `scrollBeyondLastLine` leaves that container far
    # taller than the fixture's few lines, so a center-click lands past the last
    # line, inside the locked closing tag, where the edit guard drops everything
    # typed.
    #
    # The click lands wherever in "World" it happens to land, so End (and a
    # leading space) are what make the typed word a word of its own rather than
    # a suffix of the fixture's -- the checker would otherwise flag
    # "WorldQqwerty", and the quick fix would offer to store that.
    def type_in_body(text)
      find(".monaco-editor .view-line", text: "World").click
      page.send_keys :end
      page.send_keys " #{text}"
      assert_selector ".monaco-editor", text: text, wait: 10
    end

    # Drive the real quick fix (Ctrl+.), the only route an author has to this.
    # The list also offers corrections and "Ignore this session", so pick the
    # entry by its label -- by its label alone, since the widget's own class
    # names belong to whichever Monaco build the CDN serves us.
    def add_to_dictionary(word)
      label = %(Add "#{word}" to dictionary)
      page.send_keys [ :control, "." ]
      assert_text label, wait: 10
      # Single-quoted in XPath, since the label carries the double quotes.
      row = find(:xpath, "//*[normalize-space(text())='#{label}']", match: :first)
      # Monaco covers an open widget with a transparent `context-view-pointerBlock`
      # that swallows the first click and is torn down on the first mouse move,
      # so hover before clicking.
      row.hover
      row.click
    end

    # The add is fire-and-forget from the editor's side, so poll rather than
    # assuming the POST has landed by the time the squiggle clears.
    def assert_dictionary_words_eventually(expected)
      deadline = Time.current + 10.seconds
      until @project.reload.dictionary_words == expected || Time.current > deadline
        sleep 0.2
      end
      assert_equal expected, @project.reload.dictionary_words
    end
end
