module ApplicationHelper
  def render_markdown(markdown_text)
    return "" if markdown_text.blank?

    html = Commonmarker.to_html(markdown_text)
    html.html_safe
  end

  # Renders a <time> tag in Time.zone (set per-request from the visitor's "tz"
  # cookie, see ApplicationController#set_time_zone). The title tooltip always
  # shows the full local and UTC times, regardless of what the visible text shows.
  def local_time_tag(datetime, date_only: false, relative: false)
    local = datetime.in_time_zone(Time.zone)
    utc = datetime.utc

    text =
      if relative
        "#{time_ago_in_words(datetime)} ago"
      elsif date_only
        local.strftime("%B %-d, %Y")
      else
        "#{local.strftime(full_time_format)} #{local.strftime('%Z')}"
      end

    title = "#{local.strftime(full_time_format)} #{local.strftime('%Z')}\n#{utc.strftime(full_time_format)} UTC"

    tag.time(text, datetime: utc.iso8601, title: title)
  end

  private

  def full_time_format
    "%B %-d, %Y at %-I:%M %p"
  end
end
