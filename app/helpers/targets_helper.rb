module TargetsHelper
  # State is carried three ways -- a colored stripe on the row, this pill, and the
  # wording of the timestamp beneath it -- so it survives both a glance and a screen
  # reader. Color alone never carries it.
  STATE_PILL = {
    current:  [ "Current",     "bg-green-100 text-green-800" ],
    stale:    [ "Out of date", "bg-amber-100 text-amber-900" ],
    building: [ "Building",    "bg-sky-100 text-sky-800" ],
    failed:   [ "Failed",      "bg-red-100 text-red-800" ],
    # Grey rather than red: the author stopped it on purpose, and nothing is wrong.
    canceled: [ "Canceled",    "bg-gray-100 text-gray-700" ],
    never:    [ "Not built",   "bg-gray-100 text-gray-700" ]
  }.freeze

  STATE_STRIPE = {
    current: "border-l-green-600", stale: "border-l-amber-500", building: "border-l-sky-500",
    failed: "border-l-red-500", canceled: "border-l-gray-400", never: "border-l-gray-300"
  }.freeze

  # The URL an author hands out for a published target. Points at the published origin
  # when one is configured (production and test -- user output must not script against
  # the origin that holds sessions; see docs/build-targets.md), and is a same-origin
  # path in development, where there is no second host to point at. Host and protocol
  # come from config, never from the request, so this is safe in the broadcast
  # re-render of a dashboard row, which has no request to derive a host from.
  # base_url: only for request-scoped callers (the drawer). The development fallback is
  # a bare path -- correct as an href, but useless as the copyable text an author hands
  # out -- so a caller that has a request may pass request.base_url to absolutize it.
  # When a published origin is configured, config wins and base_url is ignored.
  def target_public_url(target, base_url: nil)
    # .presence: an unset config.x key reads as an empty OrderedOptions, not nil.
    origin = Rails.application.config.x.published_url_options.presence
    return published_url(target.project, target.slug, **origin) if origin

    path = published_path(target.project, target.slug)
    base_url ? base_url + path : path
  end

  # The add-output picker, filtered to what this project can actually build. Slides only
  # come out of a <slideshow>, and offering them on an article would queue a build that
  # fails at the server -- so the restriction is enforced by absence here, and by
  # validations on Target and Project for every path that does not go through this form.
  def target_kind_options(project)
    options_for_select(
      Target::Catalog.for_document_type(project.document_type).map { |kind| [ kind.label, kind.slug ] }
    )
  end

  def target_state_pill(state)
    label, classes = STATE_PILL.fetch(state, STATE_PILL[:never])
    tag.span(class: "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold #{classes}") do
      concat tag.span("", class: "size-1.5 rounded-full bg-current #{'animate-pulse' if state == :building}")
      concat label
    end
  end

  # The projects dashboard variant: the whole pill links to the target's status page,
  # and carries the target's name (not the state label) since a row already has several
  # of these side by side.
  def target_status_pill(target)
    project = target.project
    state = target.state
    label, classes = STATE_PILL.fetch(state, STATE_PILL[:never])
    link_to project_target_path(project, target),
      class: "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-semibold #{classes}",
      title: "#{target.name} — #{label.downcase}", data: { turbo: false } do
      concat tag.span("", class: "size-1.5 rounded-full bg-current #{'animate-pulse' if state == :building}")
      concat target.name
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
      elsif build.canceled? then [ "Canceled", "bg-gray-100 text-gray-700" ]
      elsif build.in_flight? then [ "Building", "bg-sky-100 text-sky-800" ]
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
    when :canceled
      tag.span("Readers see the build from #{time_ago_in_words(target.last_built_at)} ago") +
        tag.span("The most recent build was canceled", class: "block text-gray-500")
    else
      built
    end
  end
end
