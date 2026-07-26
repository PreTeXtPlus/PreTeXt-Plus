# A named output an author manages ("my PDF"), as opposed to a Build, which is one
# attempt at producing it. Mirrors a <target> in a PreTeXt-CLI project.ptx: `name` is
# unique within a project and goes into the manifest verbatim, while `output_format` is
# free to repeat -- a project may well have "student" and "instructor" html targets.
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

  enum :output_format, { html: 0, pdf: 1, epub: 2, braille: 3, scorm: 4 },
       suffix: true, validate: true

  # `name` is written straight into project.ptx, so it has to be a legal target name.
  # REF_REGEX (config/initializers/constants.rb) is already exactly that rule.
  validates :name, presence: true, format: REF_REGEX, uniqueness: { scope: :project_id }

  default_scope { order(:position, :created_at) }

  # The four statuses that mean "the build server still owes us an answer". Authors do
  # not care which -- they all present as Building; the distinction belongs in the log.
  IN_FLIGHT = %w[ pending in_progress sent_to_server received_from_server ].freeze

  def display_label
    label.presence || name.humanize
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
end
