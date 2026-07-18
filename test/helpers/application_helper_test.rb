require "test_helper"

class ApplicationHelperTest < ActionView::TestCase
  test "local_time_tag renders in Time.zone with a UTC tooltip" do
    datetime = Time.utc(2026, 7, 18, 17, 30)

    Time.use_zone("America/Chicago") do
      html = local_time_tag(datetime)

      assert_match "July 18, 2026 at 12:30 PM CDT", html
      assert_match 'title="July 18, 2026 at 5:30 PM UTC"', html
      assert_match 'datetime="2026-07-18T17:30:00Z"', html
    end
  end

  test "local_time_tag date_only omits time and zone abbreviation" do
    datetime = Time.utc(2026, 7, 18, 17, 30)

    Time.use_zone("America/Chicago") do
      html = local_time_tag(datetime, date_only: true)

      assert_match ">July 18, 2026<", html
      assert_match 'title="July 18, 2026 UTC"', html
    end
  end
end
