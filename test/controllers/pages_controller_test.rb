require "test_helper"

class PagesControllerTest < ActionDispatch::IntegrationTest
  test "should get home" do
    get root_path
    assert_response :success
  end

  test "home banners the flagged announcement by title and links to it" do
    get root_path
    assert_select "#homepage-announcement" do
      assert_select "p", text: /#{Regexp.escape(announcements(:homepage).title)}/
      assert_select "a[href=?]", announcement_path(announcements(:homepage)), text: /Read more/
    end
  end

  test "home does not banner a paid-subscribers-only announcement" do
    announcements(:homepage).destroy
    get root_path
    assert_select "#homepage-announcement", false
    assert_not_includes response.body, announcements(:paid_only_homepage).title
  end

  test "home does not banner an unpublished announcement" do
    announcements(:homepage).destroy
    get root_path
    assert_not_includes response.body, announcements(:unpublished_homepage).title
  end

  test "home has no banner when no announcement is flagged" do
    Announcement.update_all(show_on_homepage: false)
    get root_path
    assert_response :success
    assert_select "#homepage-announcement", false
  end
end
