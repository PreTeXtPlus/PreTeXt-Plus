class Project < ApplicationRecord
  belongs_to :user

  # Collaborators (and pending invitations) die with the project; the users
  # themselves are of course untouched.
  has_many :collaborations, dependent: :destroy
  has_many :collaborators, -> { merge(Collaboration.accepted) },
    through: :collaborations, source: :user

  # The shared Yjs document backing real-time collaborative editing, plus its
  # append-only update log. Exists only while the project actually has
  # collaborations (see #collaborative? and #reset_collaborative_doc!) and is
  # created lazily by the first collaborative editor session.
  has_one :project_doc, dependent: :destroy
  has_many :project_doc_updates, dependent: :delete_all

  # dependent: :destroy so deleting a project drops its assets (and their
  # attached files) too -- an asset has no life outside its
  # project, so there's nothing to preserve.
  has_many :assets, dependent: :destroy
  # allow_destroy lets the editor delete an asset by sending `_destroy: true`.
  accepts_nested_attributes_for :assets, allow_destroy: true

  has_many :targets, dependent: :destroy
  has_many :builds, dependent: :destroy
  has_many :divisions, dependent: :destroy
  # allow_destroy lets the editor remove a division by sending `_destroy: true`.
  accepts_nested_attributes_for :divisions, allow_destroy: true

  enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true

  # Gates listing on the owner's /users/:username profile page only -- it does not
  # change who can open the project itself (see Ability). unlisted exists for a link
  # an author wants to hand out without appearing in their public index.
  enum :visibility, { private: 0, unlisted: 1, public: 2 }, default: :private, suffix: true, validate: true

  scope :publicly_listed, -> { where(visibility: :public) }

  # Templates are curated projects the PreTeXt.Plus team flags (via the admin
  # UI) as starting points; picking one duplicates it into the chooser's account.
  # A template is otherwise an ordinary project for its owner: it still appears
  # in their project list (badged, so they know edits affect what new users
  # start from) and still counts against their quota.
  scope :templates, -> { where(is_template: true) }

  default_scope { order(updated_at: :desc) }

  # Attributes a build actually consumes. Changing any of them makes every built target
  # stale; changing `title` does not. Divisions and assets bump the same timestamp from
  # their own `belongs_to ... touch:`.
  SOURCE_ATTRIBUTES = %w[ pretext_source docinfo use_common_docinfo document_type ].freeze

  # Slug omitted deliberately: Target derives "website" from this name like it does for
  # every other output, so there is one rule rather than one rule and an exception.
  DEFAULT_TARGET = { name: "Website", kind: "website" }.freeze

  # The mirror of Target's own check, and the one that is easy to miss: Rails does not
  # re-validate children when the parent changes, so without this, converting a slideshow
  # to an article would silently leave a reveal.js target behind to fail at the build
  # server for reasons the author cannot see from the dashboard.
  validate :targets_supported_by_document_type, if: :document_type_changed?

  before_validation :stamp_source_updated_at, if: -> { (changed & SOURCE_ATTRIBUTES).any? }
  before_validation(on: :create) { self.source_updated_at ||= Time.current }
  # Built (not created) so it saves in the same transaction as the project. Skipped when
  # targets are already present, which is how full_dup carries a project's own set over.
  before_create :build_default_target

  def root_division
    divisions.find_by(is_root: true)
  end

  # How many collaborators (accepted + pending invites) this project may have.
  # Keyed to the OWNER's standing, not the inviter's or invitee's. Enforced
  # only when adding (see Collaboration#within_collaborator_limit), so a lapsed
  # subscription grandfathers existing collaborators rather than evicting them.
  def collaborator_limit
    user.subscribed? || user.admin? ? 5 : 1
  end

  def editable_by?(other_user)
    return false if other_user.nil?
    other_user == user || collaborators.include?(other_user)
  end

  # Real-time collaborative editing is on whenever anyone besides the owner
  # holds (or is invited to) edit access. The editor also runs collaboratively
  # for the owner's own solo sessions on such a project, so the shared doc
  # never falls behind the divisions materialized from it.
  def collaborative?
    collaborations.any?
  end

  # Drop the shared doc and its update log. Called when the last collaboration
  # is removed: from then on the owner edits solo (non-collaborative autosave
  # writes divisions directly, leaving a persisted doc stale), so the doc is
  # reseeded from the divisions if collaboration ever starts again.
  def reset_collaborative_doc!
    project_doc&.destroy!
    project_doc_updates.delete_all
  end

  def effective_docinfo
    if use_common_docinfo? && user&.common_docinfo.present?
      user.common_docinfo
    else
      docinfo
    end
  end

  def self.default_docinfo
    DEFAULT_DOCINFO
  end

  def set_default_docinfo
    self.docinfo = DEFAULT_DOCINFO
  end

  def common_docinfo
    user.common_docinfo
  end

  DEFAULT_DOCINFO = File.read Rails.root.join("app", "default_docs", "docinfo.xml")

  TRYIT_DOCINFO = File.read Rails.root.join("app", "default_docs", "tryit", "docinfo.xml")
  TRYIT_ROOT_SOURCE = File.read Rails.root.join("app", "default_docs", "tryit", "root.tex")
  TRYIT_PRETEXT_SOURCE = File.read Rails.root.join("app", "default_docs", "tryit", "pretext.xml")
  TRYIT_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "tryit", "markdown.md")

  ENQUEUE_SOURCE_PLACEHOLDER = File.read Rails.root.join("app", "default_docs", "enqueue_placeholder.html")

  def full_dup(new_owner = nil)
    duplicate = Project.build(self.dup.attributes)
    if new_owner.present?
      duplicate.user = new_owner
    end
    duplicate.title = "Copy of #{title}"
    # Carry the target *configuration* but none of its build history, and never the
    # published flag -- a copy is not entitled to the original's public URLs.
    targets.each do |target|
      duplicate.targets.build(
        target.dup.attributes.except("current_build_id", "last_built_at", "published")
      )
    end
    divisions.each do |division|
      duplicate.divisions.build(division.dup.attributes)
    end
    assets.each do |asset|
      # Each asset is owned directly by its project, so a duplicate needs a
      # genuinely independent Asset row: copy its attributes (dup clears
      # `id`, so this gets a fresh one) and re-attach the SAME file blob --
      # no bytes are re-uploaded, only a new active_storage_attachments row
      # is created once `duplicate` saves.
      new_asset = duplicate.assets.build(asset.dup.attributes)
      new_asset.file.attach(asset.file.blob) if asset.file.attached?
    end
    duplicate
  end

  # Build a user's own project from this template: a deep copy (divisions,
  # assets, docinfo) via full_dup, but stripped of its template identity and
  # keeping the template's own title rather than "Copy of ...".
  def instantiate_from_template_for(new_owner)
    copy = full_dup(new_owner)
    copy.title = "#{title} (generated from template)"
    copy.is_template = false
    copy.template_description = nil
    copy
  end

  def enqueue_html_source_job
    self.update_column(:html_source, ENQUEUE_SOURCE_PLACEHOLDER)
    SetHtmlSourceJob.perform_later(self)
  end

  def self.tryit
    project = self.new(title: "Try it!")
    project.docinfo = TRYIT_DOCINFO
    project.divisions.build(ref: "tryit", is_root: true, source_format: :latex, source: TRYIT_ROOT_SOURCE)
    project.divisions.build(ref: "tryit-xml", source_format: :pretext, source: TRYIT_PRETEXT_SOURCE)
    project.divisions.build(ref: "tryit-markdown", source_format: :markdown, source: TRYIT_MARKDOWN_SOURCE)
    project
  end

  private

    def stamp_source_updated_at
      self.source_updated_at = Time.current
    end

    def build_default_target
      return if targets.any?

      targets.build(**DEFAULT_TARGET)
    end

    # Names the targets standing in the way rather than just refusing, because the author
    # has to go delete them and the dashboard will not tell them which.
    def targets_supported_by_document_type
      blocked = targets.reject { |target| target.kind_config&.available_for?(document_type) }
      return if blocked.empty?

      errors.add(:document_type,
                 "cannot change to #{document_type} while this project has " \
                 "#{blocked.map(&:name).to_sentence} — remove #{blocked.one? ? 'it' : 'them'} first")
    end
end
