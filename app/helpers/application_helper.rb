module ApplicationHelper
  def render_markdown(markdown_text)
    return "" if markdown_text.blank?

    html = Commonmarker.to_html(markdown_text)
    html.html_safe
  end

  # Renders a <time> tag in Time.zone (set per-request from the visitor's "tz"
  # cookie, see ApplicationController#set_time_zone), with a UTC tooltip.
  def local_time_tag(datetime, date_only: false)
    local = datetime.in_time_zone(Time.zone)
    utc = datetime.utc
    format = date_only ? "%B %-d, %Y" : "%B %-d, %Y at %-I:%M %p"

    text = local.strftime(format)
    text += " #{local.strftime('%Z')}" unless date_only

    tag.time(text, datetime: utc.iso8601, title: "#{utc.strftime(format)} UTC")
  end
end
