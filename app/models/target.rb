# A named output an author manages ("my PDF"), as opposed to a Build, which is one
# attempt at producing it. Mirrors a <target> in a PreTeXt-CLI project.ptx: `name` is
# unique within a project and goes into the manifest verbatim, while `kind` is free to
# repeat -- a project may well have "student" and "instructor" websites.
class Target < ApplicationRecord
  belongs_to :project
  has_many :builds, dependent: :destroy

  # Two pointers into `builds`, both denormalized onto this row so that rendering a
  # target's state costs no queries beyond eager-loading these two associations.
  #
  #   current_build -- the latest *successful* build: what a reader actually gets.
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

  # `name` is written straight into project.ptx, so it has to be a legal target name.
  # REF_REGEX (config/initializers/constants.rb) is already exactly that rule.
  validates :name, presence: true, format: REF_REGEX, uniqueness: { scope: :project_id }

  validate :kind_available_for_document_type

  default_scope { order(:position, :created_at) }

  # The four statuses that mean "the build server still owes us an answer". Authors do
  # not care which -- they all present as Building; the distinction belongs in the log.
  IN_FLIGHT = %w[ pending in_progress sent_to_server received_from_server ].freeze

  # The catalog entry behind this row. nil only if `kind` holds something the catalog no
  # longer offers, which the inclusion validation prevents on write.
  def kind_config
    Catalog.find(kind)
  end

  def kind_label
    kind_config&.label || kind.to_s.humanize
  end

  def display_label
    label.presence || name.humanize
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
  # to the target name means the entry point is known before the build even runs.
  def output_filename
    ext = kind_config&.filename_ext
    return nil if ext.nil?

    "#{name}.#{ext}"
  end

  # What a finished build of this kind leaves behind, used to pick the entry file out of
  # the imported output when the manifest could not name it for us.
  def output_extensions
    kind_config&.extensions || []
  end

  # Attributes ProjectArchiveBuilder derives from the row itself. `options` is free-form
  # data an author could eventually edit, and none of these may come from there: `name`
  # and `output-dir` decide where the build server writes and which prefix the artifact
  # job strips, and `output-filename` is what makes a single-file artifact findable.
  RESERVED_ATTRIBUTES = %w[ name output-dir output-filename ].freeze

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
    return :building if building?
    return :failed if latest_build.failed?
    return :never if current_build.nil?

    stale? ? :stale : :current
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

  # Recomputes both pointers from the builds themselves. Called on every create, status
  # transition and destroy, so the denormalization can never drift from the rows it
  # summarizes -- and so deleting a build (which no foreign key cascades to) falls back
  # to the previous successful one rather than leaving a dangling id.
  def sync_from_builds!
    latest = builds.order(created_at: :desc).first
    current = builds.where(status: :success).order(created_at: :desc).first

    update_columns(latest_build_id: latest&.id,
                   current_build_id: current&.id,
                   last_built_at: current&.created_at,
                   updated_at: Time.current)
  end

  private

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
