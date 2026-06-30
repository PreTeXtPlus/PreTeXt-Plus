module BuildsHelper
  STATUS_BADGE_CLASSES = {
    "pending"     => "border-gray-400 bg-gray-400",
    "in_progress" => "border-sky-500 bg-sky-500",
    "success"     => "border-green-600 bg-green-600",
    "failed"      => "border-red-500 bg-red-500"
  }.freeze

  def build_status_badge(build)
    classes = STATUS_BADGE_CLASSES.fetch(build.status, "border-gray-400 bg-gray-400")
    tag.span(build.status.humanize,
      class: "rounded-sm border #{classes} px-3 py-1.5 text-[10px] font-medium text-white")
  end
end
