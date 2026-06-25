class Project < ApplicationRecord
  belongs_to :user

  # dependent: :destroy so deleting a project drops its membership rows; the
  # library assets themselves persist (they're owned by the user, not the project).
  has_many :project_assets, dependent: :destroy
  # allow_destroy lets the editor drop a project's membership of a library asset
  # by sending `_destroy: true`; the library_asset itself is never destroyed.
  accepts_nested_attributes_for :project_assets, allow_destroy: true
  has_many :library_assets, through: :project_assets

  has_many :divisions, dependent: :destroy
  # allow_destroy lets the editor remove a division by sending `_destroy: true`.
  accepts_nested_attributes_for :divisions, allow_destroy: true

  enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true

  before_update :set_html_source

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

  def full_dup
    duplicate = Project.build(self.dup.attributes)
    duplicate.update(title: "Copy of #{title}")
    divisions.each do |division|
      duplicate.divisions.build(division.dup.attributes)
    end
    project_assets.each do |asset|
      duplicate.project_assets.build(asset.dup.attributes)
    end
    duplicate.save ? duplicate : nil
  end

  private

  def set_html_source
    require "uri"
    require "net/http"
    # For LaTeX projects, use the editor-converted PreTeXt body.
    params = {
      source: pretext_source,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)
    # See the matching comment in ProjectsController#preview -- the build
    # server writes a bare `external/<id>.<ext>` image reference into its
    # output, and this <base> pins that at the *public* redirect
    # (library_assets#share_file), since html_source renders on the public
    # /share page. Root-relative, so it needs no host config here.
    self.html_source = "<base href=\"/share_assets/\">#{response.body}"
  end
end
