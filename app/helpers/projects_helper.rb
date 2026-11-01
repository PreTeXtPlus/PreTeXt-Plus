module ProjectsHelper
  TIKZ_ENGINE = JSON.parse(Rails.root.join("config/tikz_engine.json").read).freeze

  VISIBILITY_PILL = {
    "public" =>   [ "Public",   "bg-green-100 text-green-800" ],
    "unlisted" => [ "Unlisted", "bg-amber-100 text-amber-900" ],
    "private" =>  [ "Private",  "bg-gray-100 text-gray-700" ]
  }.freeze

  # Where the TikZ engine is served from: its pinned release, unpacked under public/engines
  # by script/fetch-tikz-engine.js. A new version is a new directory, so the year-long
  # cache on public files is safe. Nil until it has been fetched; the editor then shows a
  # TikZ asset's stored picture and renders nothing live.
  def tikz_engine_url
    directory = "engines/#{TIKZ_ENGINE.fetch("name")}-#{TIKZ_ENGINE.fetch("version")}/"
    "/#{directory}" if Rails.public_path.join(directory, "index.js").exist?
  end

  def project_visibility_pill(project)
    label, classes = VISIBILITY_PILL.fetch(project.visibility)
    tag.span(label, class: "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold #{classes}")
  end

  def project_shared_pill
    tag.span("Shared", class: "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-indigo-100 text-indigo-800")
  end

  # Accepts either a project (whose root division's format is looked up) or the raw
  # source_format string the new-project form uses before a division exists yet --
  # #try keeps the lookup nil, rather than an error, when project is that string.
  def project_format_icon(project, classes: nil)
    root_division = project.try(:root_division)

    if root_division&.latex_source_format? || project == "latex"
      image_tag "latex-pretext-logo.svg", alt: "LaTeX-style PreTeXt logo", class: classes
    elsif root_division&.markdown_source_format? || project == "markdown"
      image_tag "markdown-pretext-logo.svg", alt: "Markdown-style PreTeXt logo", class: classes
    else
      image_tag "pretext-logo.svg", alt: "PreTeXt logo", class: classes
    end
  end
end
