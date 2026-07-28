module ApplicationHelper
  # Every variant is written out in full (never "bg-#{color}-600") because
  # Tailwind generates CSS by scanning the project for literal class-name
  # substrings -- an interpolated string would never match anything, and the
  # button would silently render unstyled.
  BUTTON_COLORS = {
    "indigo" => { solid: "bg-indigo-600 text-white hover:bg-indigo-500",
                  outlined: "bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50" },
    "blue"   => { solid: "bg-blue-600 text-white hover:bg-blue-500",
                  outlined: "bg-white border border-blue-300 text-blue-700 hover:bg-blue-50" },
    "green"  => { solid: "bg-green-600 text-white hover:bg-green-500",
                  outlined: "bg-white border border-green-300 text-green-700 hover:bg-green-50" },
    "red"    => { solid: "bg-red-600 text-white hover:bg-red-500",
                  outlined: "bg-white border border-red-300 text-red-700 hover:bg-red-50" },
    "sky"    => { solid: "bg-sky-600 text-white hover:bg-sky-500",
                  outlined: "bg-white border border-sky-300 text-sky-700 hover:bg-sky-50" },
    "yellow" => { solid: "bg-yellow-600 text-white hover:bg-yellow-500",
                  outlined: "bg-white border border-yellow-300 text-yellow-700 hover:bg-yellow-50" },
    # gray is only ever a secondary/neutral action, never a dark filled button
    # (that would read as disabled), so "solid" here means a light fill.
    "gray"   => { solid: "bg-gray-100 text-gray-800 hover:bg-gray-50",
                  outlined: "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50" }
  }.freeze
  private_constant :BUTTON_COLORS

  # Appearance-only classes for a button/link: color, border, text, hover, plus
  # the shared rounded-md/font-medium/cursor-pointer base. Callers still supply
  # their own padding/text-size/width classes (e.g. px-3.5 py-2, or the smaller
  # px-2.5 py-1.5 text-sm used for row-level actions) alongside this.
  def button_classes(color:, outlined: false)
    variant = BUTTON_COLORS.fetch(color) { raise ArgumentError, "Unknown button color: #{color.inspect}" }
    "rounded-md font-medium cursor-pointer #{variant.fetch(outlined ? :outlined : :solid)}"
  end

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
