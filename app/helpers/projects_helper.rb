module ProjectsHelper
  VISIBILITY_PILL = {
    "public" =>   [ "Public",   "bg-green-100 text-green-800" ],
    "unlisted" => [ "Unlisted", "bg-amber-100 text-amber-900" ],
    "private" =>  [ "Private",  "bg-gray-100 text-gray-700" ]
  }.freeze

  def project_visibility_pill(project)
    label, classes = VISIBILITY_PILL.fetch(project.visibility)
    tag.span(label, class: "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold #{classes}")
  end

  def project_format_icon(project)
    if project.root_division&.latex_source_format?
      image_tag "latex-pretext-logo.svg", alt: "LaTeX-style PreTeXt logo"
    elsif project.root_division&.markdown_source_format?
      image_tag "markdown-pretext-logo.svg", alt: "Markdown-style PreTeXt logo"
    else
      image_tag "pretext-logo.svg", alt: "PreTeXt logo"
    end
  end
end
