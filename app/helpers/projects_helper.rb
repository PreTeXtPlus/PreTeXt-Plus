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
end
