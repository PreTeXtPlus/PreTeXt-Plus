module TargetsHelper
  # State is carried three ways -- a colored stripe on the row, this pill, and the
  # wording of the timestamp beneath it -- so it survives both a glance and a screen
  # reader. Color alone never carries it.
  STATE_PILL = {
    current:  [ "Current",     "bg-green-100 text-green-800" ],
    # Two orange states, and the difference between them is who the ball is with. Orange
    # rather than amber so neither is mistaken for "Out of date" at a glance, and never
    # red -- there is output either way.
    #
    # needs_review: the build server produced output from a build that reported errors,
    # and nothing serves it until the author says so in the drawer.
    needs_review: [ "Needs review", "bg-orange-100 text-orange-900" ],
    # warned: they said so. Live output that came out of a build with errors, which the
    # row keeps saying because a reader is now reading it.
    warned:   [ "Has errors",  "bg-orange-100 text-orange-900" ],
    stale:    [ "Out of date", "bg-amber-100 text-amber-900" ],
    building: [ "Building",    "bg-sky-100 text-sky-800" ],
    queued:   [ "Queued",      "bg-sky-50 text-sky-700" ],
    failed:   [ "Failed",      "bg-red-100 text-red-800" ],
    # Grey rather than red: the author stopped it on purpose, and nothing is wrong.
    canceled: [ "Canceled",    "bg-gray-100 text-gray-700" ],
    never:    [ "Not built",   "bg-gray-100 text-gray-700" ]
  }.freeze

  STATE_STRIPE = {
    current: "border-l-green-600", needs_review: "border-l-orange-500",
    warned: "border-l-orange-400", stale: "border-l-amber-500", building: "border-l-sky-500",
    queued: "border-l-sky-300",
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

  # What publishing has to ask first, as the one `data-turbo-confirm` string a single
  # dialog can carry. Two independent reasons to pause -- escalating a private project's
  # visibility, and putting output from a build that reported errors behind a link an
  # author hands out -- and a target can easily have both. Returns the data hash the
  # buttons splat, so `{}` is the "nothing to ask" case.
  def publish_confirm(target)
    reasons = []
    if target.current_build&.built_with_errors?
      reasons << "This output came from a build that reported errors, so parts of it may be missing or wrong."
    end
    if target.project.private_visibility?
      reasons << "Publishing will make this project's visibility Unlisted (it's currently Private)."
    end
    return {} if reasons.empty?

    { turbo_confirm: reasons.push("Continue?").join(" ") }
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
      elsif build.queued? then [ "Queued", "bg-sky-50 text-sky-700" ]
      elsif build.unresolved? then [ "Building", "bg-sky-100 text-sky-800" ]
      # Imported, previewable, and serving nobody until the author accepts it. Ahead of
      # the current_build check because it is emphatically *not* that, and "Superseded"
      # -- what it would otherwise read as -- is the opposite of true: it is the newest
      # build there is.
      elsif build.success_awaiting_review? then [ "Not live · errors", "bg-orange-100 text-orange-900" ]
      # The errors belong on the row for the attempt that had them, not only on the
      # target: a history where the live build reads plain "Live" gives an author no way
      # to tell which of two builds is the one whose log they were told to read.
      elsif build.id == target.current_build_id
        build.built_with_errors? ? [ "Live · errors", "bg-orange-100 text-orange-900" ] :
                                   [ "Live", "bg-green-100 text-green-800" ]
      elsif build.built_with_errors? then [ "Superseded · errors", "bg-gray-100 text-gray-700" ]
      else [ "Superseded", "bg-gray-100 text-gray-700" ]
      end

    tag.span(label,
      class: "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold #{classes}")
  end

  # "Built 2 hours ago", plus the second line that keeps a failed rebuild honest about
  # what readers are actually seeing.
  def target_timing(target)
    if target.current_build.nil?
      return tag.span("Waiting for a build slot") if target.state == :queued
      # Nothing live, but something built: the first build of this output came back
      # flagged, so there is output waiting on the author rather than nothing at all.
      if target.state == :needs_review
        return tag.span("Nothing live yet") + review_prompt
      end

      return tag.span("Added #{time_ago_in_words(target.created_at)} ago")
    end

    built = tag.span("Built #{time_ago_in_words(target.last_built_at)} ago")
    case target.state
    when :needs_review
      tag.span("Readers see the build from #{time_ago_in_words(target.last_built_at)} ago") + review_prompt
    when :warned
      built + tag.span("The build reported errors — check the log", class: "block text-orange-700")
    when :stale
      built + tag.span("Source has changed since", class: "block text-amber-700")
    when :queued
      built + tag.span("Waiting for a build slot", class: "block text-gray-500")
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

  # The second line under a :needs_review row. Says where the decision is made, because
  # the row itself deliberately does not offer it -- previewing the output first is the
  # entire point, and that lives in the drawer.
  def review_prompt
    tag.span("The latest build has errors — review it in this output's details",
      class: "block text-orange-700")
  end

  # The dashboard's bulk-build button label, or nil when nothing qualifies -- mirrors
  # Target.bulk_build_candidates so the label can never promise a target it wouldn't
  # actually build.
  def bulk_build_label(targets)
    candidates = Target.bulk_build_candidates(targets)
    return nil if candidates.empty?

    candidates.first.state == :never ? "Build all" : "Rebuild outdated"
  end
end
