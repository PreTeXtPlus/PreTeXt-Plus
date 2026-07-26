# A named output an author manages ("my PDF"), as opposed to a Build, which is one
# attempt at producing it. Mirrors a <target> in a PreTeXt-CLI project.ptx: `name` is
# unique within a project and goes into the manifest verbatim, while `output_format` is
# free to repeat -- a project may well have "student" and "instructor" html targets.
class Target < ApplicationRecord
  belongs_to :project
  has_many :builds, dependent: :destroy

  # The latest *successful* build: what a reader of a published target actually gets.
  # Denormalized onto this row (see CreateTargets) so the projects index can render every
  # target's state without a query per target. No `dependent:` -- a Target does not own
  # its current build, it points at one of the builds it already owns via has_many.
  belongs_to :current_build, class_name: "Build", optional: true

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

  def latest_build
    builds.order(created_at: :desc).first
  end

  def building?
    builds.where(status: Build.statuses.values_at(*IN_FLIGHT)).exists?
  end

  # Built before the author's most recent edit, so what readers see is behind the source.
  def stale?
    current_build.present? && current_build.created_at < project.source_updated_at
  end

  # The single state a row displays. Describes the most recent *attempt*; what readers
  # currently see is `current_build`, and the two are deliberately independent -- a
  # failed rebuild leaves a published target serving its last good build, and the UI has
  # to be able to say both things at once.
  def state
    return :building if building?
    return :failed if latest_build&.failed?
    return :never if current_build.nil?

    stale? ? :stale : :current
  end

  # Called by Build#mark! on every transition, so that promoting a finished build is not
  # something a new transition site can forget to do.
  def adopt!(build)
    return unless build.success?

    update_columns(current_build_id: build.id,
                   last_built_at: build.created_at,
                   updated_at: Time.current)
  end

  # Recomputes the pointer from scratch. Needed when the current build is deleted, since
  # current_build_id has no foreign key to cascade.
  def refresh_current_build!
    latest = builds.where(status: :success).order(created_at: :desc).first
    update_columns(current_build_id: latest&.id,
                   last_built_at: latest&.created_at,
                   updated_at: Time.current)
  end
end
