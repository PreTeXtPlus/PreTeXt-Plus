module ApplicationHelper
  def render_markdown(markdown_text)
    return "" if markdown_text.blank?

    html = Commonmarker.to_html(markdown_text)
    html.html_safe
  end

  # Renders a <time> tag whose visible text is upgraded to the browser's
  # local timezone via the "local-time" Stimulus controller. The initial
  # (pre-JS) text and the tooltip are both rendered in UTC server-side.
  def local_time_tag(datetime, date_only: false)
    utc = datetime.utc
    format = date_only ? "%B %-d, %Y" : "%B %-d, %Y at %-I:%M %p"

    tag.time(
      utc.strftime(format),
      datetime: utc.iso8601,
      title: "#{utc.strftime(format)} UTC",
      data: {
        controller: "local-time",
        local_time_date_only_value: date_only
      }
    )
  end
end
