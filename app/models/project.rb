class Project < ApplicationRecord
  belongs_to :user

  # dependent: :destroy so deleting a project drops its assets (and their
  # attached files) too -- unlike divisions, an asset has no life outside its
  # project, so there's nothing to preserve.
  has_many :assets, dependent: :destroy
  # allow_destroy lets the editor delete an asset by sending `_destroy: true`.
  accepts_nested_attributes_for :assets, allow_destroy: true

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

  # Assets follow the same client-minted-UUID pattern as divisions: unlike a
  # division (which gets its id from a dedicated create endpoint before ever
  # reaching this payload), an asset's FIRST creation happens right here --
  # there is no separate AssetsController#create. The editor mints the id
  # itself and sends it as part of the same assets_attributes entry that
  # carries the ref/kind/file/etc, so we pre-build an asset with that id and
  # let `super`'s nested assignment update it into an INSERT under the
  # client-supplied id. Existing ids update in place (ref renames, authored-
  # source edits); `_destroy` deletes the asset (and its attached file)
  # outright.
  def assets_attributes=(attributes)
    entries = attributes.respond_to?(:values) ? attributes.values : attributes
    assets.load
    known_ids = assets.map { |a| a.id.to_s }
    entries.each do |entry|
      id = entry[:id] || entry["id"]
      next if id.blank? || known_ids.include?(id.to_s)
      assets.build(id: id)
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
end
