class Project < ApplicationRecord
  belongs_to :user

  # dependent: :destroy so deleting a project drops its membership rows; the
  # library assets themselves persist (they're owned by the user, not the project).
  has_many :project_assets, dependent: :destroy
  # allow_destroy lets the editor drop a project's membership of a library asset
  # by sending `_destroy: true`; the library_asset itself is never destroyed.
  accepts_nested_attributes_for :project_assets, allow_destroy: true
  has_many :library_assets, through: :project_assets

  has_many :builds, dependent: :destroy
  has_many :divisions, dependent: :destroy
  # allow_destroy lets the editor remove a division by sending `_destroy: true`.
  accepts_nested_attributes_for :divisions, allow_destroy: true

  enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true

  default_scope { order(updated_at: :desc) }

  # The editor mints a client-side UUID for each new division and sends it as
  # the division's `id`.  Rails' default nested-attributes handling raises
  # RecordNotFound for an id with no matching row, so we pre-build a division
  # with that id: the standard nested assignment (via `super`) then *updates*
  # it, causing an INSERT with the client-supplied UUID on save.  Existing ids
  # update in place and `_destroy` still removes -- so a division's identity
  # (its UUID) stays stable even when its xml:id (`ref`) is renamed later.
  def divisions_attributes=(attributes)
    entries = attributes.respond_to?(:values) ? attributes.values : attributes
    divisions.load # load so the freshly built records are matched by id below
    known_ids = divisions.map { |d| d.id.to_s }
    entries.each do |entry|
      id = entry[:id] || entry["id"]
      next if id.blank? || known_ids.include?(id.to_s)
      divisions.build(id: id)
      known_ids << id.to_s
    end
    super
  end

  # Project assets follow the same client-minted-UUID pattern as divisions: the
  # editor sends a fresh join-row id for each newly added library asset, so we
  # pre-build a project_asset with that id and let `super`'s nested assignment
  # update it into an INSERT.  Existing ids update in place; `_destroy` removes
  # only the membership row, leaving the library asset intact.
  def project_assets_attributes=(attributes)
    entries = attributes.respond_to?(:values) ? attributes.values : attributes
    project_assets.load
    known_ids = project_assets.map { |a| a.id.to_s }
    entries.each do |entry|
      id = entry[:id] || entry["id"]
      next if id.blank? || known_ids.include?(id.to_s)
      project_assets.build(id: id)
      known_ids << id.to_s
    end
    super
  end

  def root_division
    divisions.find_by(is_root: true)
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
  TRYIT_LATEX_SOURCE = File.read Rails.root.join("app", "default_docs", "tryit", "latex.tex")
  TRYIT_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "tryit", "markdown.md")

  ENQUEUE_SOURCE_PLACEHOLDER = File.read Rails.root.join("app", "default_docs", "enqueue_placeholder.html")

  def full_dup(new_owner = nil)
    duplicate = Project.build(self.dup.attributes)
    if new_owner.present?
      duplicate.user = new_owner
    end
    duplicate.title = "Copy of #{title}"
    divisions.each do |division|
      duplicate.divisions.build(division.dup.attributes)
    end
    project_assets.each do |asset|
      # library_asset may be wrong here for changed user,
      # but a before_commit callback will fix this before save
      duplicate.project_assets.build(asset.dup.attributes)
    end
    duplicate
  end

  def enqueue_html_source_job
    self.update_column(:html_source, ENQUEUE_SOURCE_PLACEHOLDER)
    SetHtmlSourceJob.perform_later(self)
  end

  def self.tryit
    project = self.new(title: "Try it!")
    project.docinfo = TRYIT_DOCINFO
    project.divisions.build(ref: "tryit", is_root: true, source_format: :latex, source: TRYIT_ROOT_SOURCE)
    project.divisions.build(ref: "tryit-pretext", source_format: :pretext, source: TRYIT_PRETEXT_SOURCE)
    project.divisions.build(ref: "tryit-latex", source_format: :latex, source: TRYIT_LATEX_SOURCE)
    project.divisions.build(ref: "tryit-markdown", source_format: :markdown, source: TRYIT_MARKDOWN_SOURCE)
    project
  end
end
