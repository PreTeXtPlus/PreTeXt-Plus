module ApplicationHelper
  def render_markdown(markdown_text)
    return "" if markdown_text.blank?

    html = Commonmarker.to_html(markdown_text)
    html.html_safe
  end
end
