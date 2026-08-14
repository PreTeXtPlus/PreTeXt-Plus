# A named output an author manages ("my PDF"), as opposed to a Build, which is one
# attempt at producing it. Mirrors a <target> in a PreTeXt-CLI project.ptx: every target
# has its own `slug`, while `kind` is free to repeat -- a project may well have "student"
# and "instructor" websites.
#
# Naming is two columns because it serves two audiences. `name` is the author's ("Print
# edition"), and it is the only one the interface asks for. `slug` is PreTeXt's: it goes
# into project.ptx verbatim and addresses the published output, so it is derived from the
# name rather than typed, and then left alone.
class Target < ApplicationRecord
  # The last word on publisher options: whatever this output sets beats the project's and
  # the owner's account defaults. See Publication::Settings.
  include HasPublicationSettings

  belongs_to :project
  has_many :builds, dependent: :destroy

  # Two pointers into `builds`, both denormalized onto this row so that rendering a
  # target's state costs no queries beyond eager-loading these two associations.
  #
  #   current_build -- the newest build this target may serve (Build.live_candidates):
  #                    what a reader actually gets. Not simply the latest success --
  #                    output from a build that reported errors waits to be accepted.
  #   latest_build  -- the most recent attempt, however it went: what the pill reports.
  #
  # They diverge exactly when a rebuild fails over a published output, which is the case
  # the whole design exists to represent. No `dependent:` on either -- a Target does not
  # own these builds separately, it points at ones it already owns through has_many.
  belongs_to :current_build, class_name: "Build", optional: true
  belongs_to :latest_build, class_name: "Build", optional: true

  # What the author chose, at the author's altitude ("a SCORM package"), rather than
  # PreTeXt's decomposition of it (`format="html" compression="scorm"`). Target::Catalog
  # owns the translation; see the comment there for why the storage goes this way round.
  #
  # A plain validated string rather than an `enum`: the catalog already supplies the
  # picker options and every predicate a caller needs, so an enum would only add a
  # second list to keep in step -- and integer backing is what made renaming a value a
  # data migration last time.
  validates :kind, inclusion: { in: ->(_target) { Catalog.slugs },
                                message: "is not an output PreTeXt.Plus can build" }

  # Trailing space is a typo, not a distinct output: without this, "Print " sits next to
  # "Print" on the dashboard and the uniqueness check below waves it through.
  normalizes :name, with: ->(name) { name.strip }

  # Free text -- it is a heading on a dashboard, not an identifier. Unique per project
  # only so that two rows are told apart by the thing an author reads them by; the
  # constraint that actually matters is on the slug.
  validates :name, presence: true,
                   uniqueness: { scope: :project_id, case_sensitive: false }

  # `slug` is written straight into project.ptx, so it has to be a legal target name.
  # REF_REGEX (config/initializers/constants.rb) is already exactly that rule. Never
  # assigned from user input: assign_slug derives it, and the uniqueness rule here is a
  # backstop for the one path that carries a slug in ready-made, Project#full_dup.
  #
  # Conditional because these have nothing to say about a target with no name yet: the
  # author made one mistake, and the flash should not report it three times.
  validates :slug, presence: true, format: REF_REGEX, uniqueness: { scope: :project_id },
                   if: -> { name.present? }

  before_validation :generate_default_name, on: :create
  before_validation :assign_slug, on: :create

  validate :kind_available_for_document_type

  # Publishing exposes a public URL, which a "Private" project isn't supposed to have.
  # Escalating rather than blocking keeps the Publish button working with no extra step
  # -- the confirm dialog in the view is what gives the author a chance to back out first.
  after_update :unlist_project_if_needed, if: :saved_change_to_published?

  default_scope { order(:position, :created_at) }

  # The statuses that mean "the build server still owes us an answer" -- or, for
  # received_from_server_flagged, that the answer is in hand but FullBuildArtifactJob
  # hasn't finished importing it yet. Authors do not care which -- they all present as
  # Building; the distinction belongs in the log.
  IN_FLIGHT = %w[ pending in_progress sent_to_server received_from_server
                  received_from_server_flagged ].freeze

  # IN_FLIGHT plus queued: everything that hasn't reached an outcome yet, whether the
  # build server owes us an answer or we haven't sent it there yet. Used wherever "don't
  # treat this as done, and don't garbage-collect it" matters more than whether it's
  # using a concurrency slot -- prune_builds! and Build#unresolved? both mean this, not
  # IN_FLIGHT itself.
  UNRESOLVED = (IN_FLIGHT + %w[ queued ]).freeze

  # How many successful builds a target retains. Two, not one, is what makes "Restore
  # previous build" possible: the one readers see, and the one to fall back to. Anything
  # deeper is dead weight -- nothing in the app reads past these -- and each successful
  # build is a whole unpacked site of Active Storage blobs plus its zip, so unbounded
  # history is a storage bill, not a feature.
  KEPT_SUCCESSES = 2

  # How many attempts the drawer's history table shows. Well above what prune_builds!
  # actually keeps, so in practice it is a ceiling rather than a cut.
  HISTORY_LIMIT = 20

  # The catalog entry behind this row. nil only if `kind` holds something the catalog no
  # longer offers, which the inclusion validation prevents on write.
  def kind_config
    Catalog.find(kind)
  end

  def kind_label
    kind_config&.label || kind.to_s.humanize
  end

  # Whole-site output the visitor browses, versus one file they open or download. Drives
  # whether the UI says "View" or "Download", and whether publishing points at an
  # index.html or at the artifact itself.
  #
  # Declared by the kind rather than inferred from format and compression: a SCORM
  # package is html underneath but is a file you hand to an LMS, not a site to browse.
  def site?
    kind_config&.site || false
  end

  # Whether opening the artifact in a browser means anything. A PDF or a reveal.js deck
  # is worth opening; a SCORM package is a zip, and an "Open" button on it would just be
  # a download that looks like something else.
  def viewable?
    kind_config&.viewable || false
  end

  # The filename we ask PreTeXt to produce, where the manifest lets us name it. Fixing it
  # to the slug means the entry point is known before the build even runs.
  def output_filename
    ext = kind_config&.filename_ext
    return nil if ext.nil?

    "#{slug}.#{ext}"
  end

  # What a finished build of this kind leaves behind, used to pick the entry file out of
  # the imported output when the manifest could not name it for us.
  def output_extensions
    kind_config&.extensions || []
  end

  # Attributes ProjectArchiveBuilder derives from the row itself. `options` is free-form
  # data an author could eventually edit, and none of these may come from there: `name`
  # (the slug) and `output-dir` decide where the build server writes and which prefix the
  # artifact job strips, `output-filename` is what makes a single-file artifact findable,
  # and `publication` points at the file the builder just wrote from this target's
  # publisher options -- which is where an author changes any of that.
  RESERVED_ATTRIBUTES = %w[ name output-dir output-filename publication ].freeze

  # Everything this target contributes to its <target> element in project.ptx: what the
  # kind emits, plus any per-target tuning in `options`. Keys are attribute names as the
  # schema spells them, which is why both sides use strings.
  #
  # `options` wins on conflict, so a target can override an attribute of its kind without
  # the catalog needing a variant for every combination.
  def manifest_attributes
    (kind_config&.emits || {}).merge(options).except(*RESERVED_ATTRIBUTES)
  end

  # Where a reader should be sent. Prefers what the build actually reported, since only
  # the build knows what braille or a packaged target really produced.
  def entry_path
    current_build&.entry_path || (site? ? "index.html" : output_filename)
  end

  def building?
    IN_FLIGHT.include?(latest_build&.status)
  end

  # Built before the author's most recent edit, so what readers see is behind the source.
  def stale?
    current_build.present? && current_build.created_at < project.source_updated_at
  end

  # The single state a row displays. Describes the most recent *attempt*; what readers
  # currently see is `current_build`, and the two are deliberately independent -- a
  # failed rebuild leaves a published target serving its last good build, and the UI has
  # to be able to say both things at once.
  #
  # Reads only denormalized columns and the two belongs_to pointers, so a page rendering
  # many targets costs a fixed number of queries.
  def state
    return :never if latest_build.nil?
    return :queued if latest_build.queued?
    return :building if building?
    return :failed if latest_build.failed?
    return :canceled if latest_build.canceled?
    # Ahead of the current_build checks below, and deliberately: a target whose *first*
    # build came back flagged has no live build at all, and reporting that as :never --
    # "not built" -- would hide imported output the author is being asked about.
    return :needs_review if latest_build.success_awaiting_review?
    return :never if current_build.nil?
    return :stale if stale?
    # Output that imported cleanly out of a build the CLI called a failure (see
    # Build#built_with_errors?). Ranked below :stale because an author who has edited
    # since is going to rebuild anyway, and the drawer carries the warning either way.
    return :warned if current_build.built_with_errors?

    :current
  end

  def cancelable?
    [ :building, :queued ].include?(state)
  end

  # What "Build all" / "Rebuild outdated" queues right now, given a project's
  # (preloaded) targets. :never wins over :stale even when both exist -- a target no
  # one has tried to build is the more urgent gap. :building, :queued, :failed, and
  # :canceled never qualify; those keep the per-row Rebuild button. [] when neither
  # applies, so callers never have to nil-check before iterating.
  def self.bulk_build_candidates(targets)
    never_built_targets = targets.select { |t| t.state == :never }
    return never_built_targets if never_built_targets.any?

    targets.select { |t| t.state == :stale }
  end

  # The drawer's history table: recent attempts, newest first.
  def recent_builds
    builds.order(created_at: :desc).limit(HISTORY_LIMIT)
  end

  # Pushes a freshly rendered row to anyone watching the project's dashboard. Called from
  # Build#mark! on every transition, which is what makes a build's progress visible
  # without the page-level <meta refresh> the old builds view relied on.
  #
  # Rendered in a background job, so the partial has no session: it must not call
  # `can?` or touch current_user. Authorization lives on the actions instead.
  def broadcast_row
    broadcast_replace_later_to(
      [ project, :targets ],
      target: ActionView::RecordIdentifier.dom_id(self),
      partial: "targets/target",
      locals: { target: self }
    )
  end

  # Same transition, for anyone who has *this* target's drawer open: state, log and
  # history all live in there, and none of them moved when only the row was replaced.
  #
  # Sends a signal rather than the drawer's HTML -- see the reload_drawer stream action in
  # app/javascript/turbo_stream_actions.js, which answers it by reloading the frame the
  # panel sits in. The drawer is the wrong shape to push down a socket: it carries the
  # build log, which FullBuildLogJob deliberately grows from a 4000-char tail to the whole
  # server-side log the moment a build finishes, plus up to HISTORY_LIMIT history rows. As
  # HTML that is unbounded and, on a hot path, wasteful; in development it is worse than
  # wasteful, because cable.yml uses Postgres LISTEN/NOTIFY there and NOTIFY rejects any
  # payload past ~8000 bytes, in a background job, with nothing surfaced to the browser.
  # A signal is ~200 bytes forever, and the content comes back over ordinary HTTP with the
  # author's own session behind it.
  #
  # Aimed at the panel's per-target dom id rather than the "drawer" frame's, for the
  # reason targets#publish guards its own drawer replace on the frame id: every dashboard
  # watching this project carries that frame, and only some of them have *this* target
  # open. An id that matches nothing yields no targetElements and the action no-ops, which
  # is exactly right for a closed drawer, or one showing a different output.
  #
  # Synchronous, unlike broadcast_row: with nothing to render there is no work to move
  # off the caller, and a job would cost more than the NOTIFY it wraps.
  def broadcast_drawer
    broadcast_action_to(
      [ project, :targets ],
      action: :reload_drawer,
      target: ActionView::RecordIdentifier.dom_id(self, :drawer),
      render: false
    )
  end

  # Recomputes both pointers from the builds themselves. Called on every create, status
  # transition and destroy, so the denormalization can never drift from the rows it
  # summarizes -- and so deleting a build (which no foreign key cascades to) falls back
  # to the previous successful one rather than leaving a dangling id.
  def sync_from_builds!
    latest = builds.order(created_at: :desc).first
    # live_candidates, not every success: output from a build the server flagged waits
    # for the author's go-ahead (Build#awaiting_review?), so what readers see does not
    # move on the strength of a build that reported errors.
    current = builds.live_candidates.order(created_at: :desc).first

    update_columns(latest_build_id: latest&.id,
                   current_build_id: current&.id,
                   last_built_at: current&.created_at,
                   updated_at: Time.current)
  end

  # What "Restore previous build" would fall back to; nil is what hides the button.
  # Same scope as current_build is chosen from, so this is genuinely the step behind it
  # -- an unreviewed build with errors sits outside this ordering entirely and cannot be
  # what restoring lands on.
  def previous_successful_build
    builds.live_candidates.order(created_at: :desc).offset(1).first
  end

  # The decision waiting on the author: imported output from a build the server flagged,
  # which is newer than what readers see and is not serving anyone yet. Only ever the
  # latest attempt -- once a newer build exists, that one is the question, and an older
  # unreviewed build is simply history.
  def build_awaiting_review
    latest_build if latest_build&.success_awaiting_review?
  end

  # Enforces the retention window, called after each build succeeds. Keeps the
  # KEPT_SUCCESSES newest successes, anything still in flight (the build server owes an
  # answer, and its callback must find the row), and the newest build outright -- that
  # last one is how the most recent *failure* survives to keep `state` and the drawer's
  # log honest. Everything older goes, cascading build_files and purging their blobs.
  #
  # Each destroy re-runs sync_from_builds! via Build's after_destroy; redundant here,
  # but it keeps "a destroyed build can never leave a dangling pointer" true with no
  # exceptions to reason about.
  def prune_builds!
    keep_ids = builds.successful.order(created_at: :desc).limit(KEPT_SUCCESSES).ids
    keep_ids |= builds.where(status: UNRESOLVED).ids
    keep_ids |= builds.order(created_at: :desc).limit(1).ids
    # Explicitly, rather than trusting the window above to contain it: a success that is
    # not live (one awaiting review) still counts against KEPT_SUCCESSES, so two of them
    # stacked ahead of the live build would otherwise delete the very thing the public
    # link is serving.
    keep_ids |= [ current_build_id ].compact

    builds.where.not(id: keep_ids).destroy_all
  end

  private

    # Backs the "Name (optional)" field on the dashboard's add-output form: an author who
    # doesn't care to type one still gets a row that reads as something instead of hitting
    # the presence validation below. Runs before assign_slug, which needs a name to derive
    # from.
    #
    # Keyed off kind_label rather than a placeholder like "Untitled" so the generated name
    # still says what the output is, and deduplicated the same way assign_slug dedupes
    # slugs -- except the uniqueness this backstops is case-insensitive, so the check here
    # has to be too.
    def generate_default_name
      return if name.present?

      base = kind_label
      return if base.blank?

      candidate = base
      suffix = 2
      while project&.targets&.exists?([ "LOWER(name) = ?", candidate.downcase ])
        candidate = "#{base} #{suffix}"
        suffix += 1
      end
      self.name = candidate
    end

    # Assigned once, at creation, and never recomputed: the slug is in a public URL and in
    # `pretext build <slug>` on a downloaded copy, so renaming an output on the dashboard
    # must not silently break a link an author has already handed out. It drifting from a
    # later name is the price, and the drawer says so.
    #
    # Skipped when one is already set, which is how Project#full_dup carries a project's
    # target slugs across to the copy instead of re-deriving (and possibly renumbering)
    # them.
    def assign_slug
      return if slug.present? || name.blank?

      base = slug_base
      suffix = 2
      self.slug = base
      while project&.targets&.exists?(slug: slug)
        self.slug = "#{base}-#{suffix}"
        suffix += 1
      end
    end

    # `parameterize` gets most of the way there -- lowercase, hyphens, no punctuation --
    # but a PreTeXt target name must also start with a letter, and "2nd edition" or "★"
    # leaves nothing legal behind. Falling back to the kind keeps the result meaningful in
    # project.ptx, which a generated id would not.
    def slug_base
      candidate = name.parameterize
      return candidate if candidate.match?(/\A[a-z]/)

      [ kind.to_s.parameterize.presence || "target", candidate.presence ].compact.join("-")
    end

    def unlist_project_if_needed
      return unless published?
      return unless project.private_visibility?

      project.update!(visibility: :unlisted)
    end

    # PreTeXt can only build slides from a <slideshow>, so a revealjs target on an article
    # would queue a build that cannot succeed. Project carries the mirror of this rule,
    # for the case where the document type changes out from under an existing target.
    def kind_available_for_document_type
      entry = kind_config
      return if entry.nil? || project.nil?
      return if entry.available_for?(project.document_type)

      errors.add(:kind, "#{entry.label} is only available for " \
                        "#{entry.document_types.to_sentence(two_words_connector: ' or ')} projects")
    end
end
