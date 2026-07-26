module TargetsHelper
  # State is carried three ways -- a colored stripe on the row, this pill, and the
  # wording of the timestamp beneath it -- so it survives both a glance and a screen
  # reader. Color alone never carries it.
  STATE_PILL = {
    current:  [ "Current",     "bg-green-100 text-green-800" ],
    stale:    [ "Out of date", "bg-amber-100 text-amber-900" ],
    building: [ "Building",    "bg-sky-100 text-sky-800" ],
    failed:   [ "Failed",      "bg-red-100 text-red-800" ],
    never:    [ "Not built",   "bg-gray-100 text-gray-700" ]
  }.freeze

  STATE_STRIPE = {
    current: "border-l-green-600", stale: "border-l-amber-500", building: "border-l-sky-500",
    failed: "border-l-red-500", never: "border-l-gray-300"
  }.freeze

  # Formats offered in the add-output form. Every value is one PreTeXt's project.ptx
  # schema accepts; the wording is what an author would call the thing they want.
  FORMAT_CHOICES = [
    [ "Website (HTML)", "html" ],
    [ "PDF", "pdf" ],
    [ "EPUB", "epub" ],
    [ "Kindle", "kindle" ],
    [ "Braille", "braille" ],
    [ "Slides (reveal.js)", "revealjs" ],
    [ "LaTeX source", "latex" ]
  ].freeze

  def target_format_options
    options_for_select(FORMAT_CHOICES)
  end

  def target_state_pill(state)
    label, classes = STATE_PILL.fetch(state, STATE_PILL[:never])
    tag.span(class: "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold #{classes}") do
      concat tag.span("", class: "size-1.5 rounded-full bg-current #{'animate-pulse' if state == :building}")
      concat label
    end
  end

  def target_state_stripe(state)
    STATE_STRIPE.fetch(state, STATE_STRIPE[:never])
  end

  # A row in the drawer's history table. "Live" and "Superseded" are distinctions that
  # only exist relative to the target, which is why this is not Build#state.
  def build_history_pill(build, target)
    label, classes =
      if build.failed? then [ "Failed", "bg-red-100 text-red-800" ]
      elsif Target::IN_FLIGHT.include?(build.status) then [ "Building", "bg-sky-100 text-sky-800" ]
      elsif build.id == target.current_build_id then [ "Live", "bg-green-100 text-green-800" ]
      else [ "Superseded", "bg-gray-100 text-gray-700" ]
      end

    tag.span(label,
      class: "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold #{classes}")
  end

  # "Built 2 hours ago", plus the second line that keeps a failed rebuild honest about
  # what readers are actually seeing.
  def target_timing(target)
    return tag.span("Added #{time_ago_in_words(target.created_at)} ago") if target.current_build.nil?

    built = tag.span("Built #{time_ago_in_words(target.last_built_at)} ago")
    case target.state
    when :stale
      built + tag.span("Source has changed since", class: "block text-amber-700")
    when :failed
      tag.span("Readers see the build from #{time_ago_in_words(target.last_built_at)} ago") +
        tag.span("The most recent build failed", class: "block text-red-700")
    else
      built
    end
  end
end
