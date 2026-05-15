class Project < ApplicationRecord
  belongs_to :user
  has_many_attached :images
  has_many_attached :build_artifacts
  attr_accessor :skip_sync_build

  enum :source_format, { pretext: 0, latex: 1, markdown: 2 }, default: :pretext, suffix: true, validate: true
  enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true

  ALLOWED_IMAGE_CONTENT_TYPES = %w[image/png image/jpeg image/gif image/webp image/svg+xml].freeze
  MAX_IMAGE_SIZE_BYTES = 10.megabytes

  before_update :set_html_source, unless: :skip_sync_build?

  default_scope { order(updated_at: :desc) }

  # Wraps the project source in a full PreTeXt document, including docinfo.
  def full_pretext_source
    if latex_source_format? && pretext_source.blank?
      return source.to_s
    end
    doc_tag = document_type || "article"

    <<~XML.squish
      <pretext>
        #{effective_docinfo.to_s if effective_docinfo.present?}
        <#{doc_tag} label="article">
          #{"<title>"+title+"</title>" if title.present?}
          #{pretext_source.present? ? pretext_source.to_s : source.to_s}
        </#{doc_tag}>
      </pretext>
    XML
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

  def set_default_source
    if pretext_source_format?
      self.source = DEFAULT_PRETEXT_SOURCE
    elsif markdown_source_format?
      self.source  = DEFAULT_MARKDOWN_SOURCE
    else  # latex
      self.source = DEFAULT_LATEX_SOURCE
    end
  end

  def set_default_docinfo
    self.docinfo = DEFAULT_DOCINFO
  end

  def common_docinfo
    user.common_docinfo
  end

  def to_h
    [ :title, :source, :source_format, :pretext_source, :docinfo, :use_common_docinfo, :common_docinfo ]
      .map { |attr| [ attr, self.send(attr) ] }.to_h
  end

  def rendered_html_source
    artifact_entry_html_from_storage.presence || artifact_entry_html.presence || html_source
  end

  def artifact_entry_html
    manifest = artifact_manifest.is_a?(Hash) ? artifact_manifest : {}
    entrypoint = manifest["entrypoint"].to_s
    return if entrypoint.blank?

    inline_files = manifest["inline_files"]
    return unless inline_files.is_a?(Hash)

    inline_files[entrypoint]
  end

  def artifact_attachment_for(path)
    return if path.blank?

    candidates = [ path.to_s ]
    candidates << "assets/#{path}" unless path.to_s.start_with?("assets/")

    build_artifacts.find do |attachment|
      metadata = attachment.blob.metadata || {}
      artifact_path = metadata["artifact_path"].presence || metadata.dig("custom", "artifact_path").to_s
      filename = attachment.blob.filename.to_s
      candidates.include?(artifact_path) || candidates.include?(filename)
    end
  end

  def self.image_upload_error(upload)
    return "image is required" if upload.blank?

    content_type = upload.content_type.to_s
    unless ALLOWED_IMAGE_CONTENT_TYPES.include?(content_type)
      return "unsupported image format"
    end

    if upload.size.to_i > MAX_IMAGE_SIZE_BYTES
      return "image is too large (max 10 MB)"
    end

    nil
  end

  DEFAULT_DOCINFO = File.read Rails.root.join("app", "default_docs", "docinfo.xml")
  DEFAULT_PRETEXT_SOURCE = File.read Rails.root.join("app", "default_docs", "pretext.xml")
  DEFAULT_LATEX_SOURCE = File.read Rails.root.join("app", "default_docs", "latex.tex")
  DEFAULT_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "markdown.md")

  private

  def artifact_entry_html_from_storage
    manifest = artifact_manifest.is_a?(Hash) ? artifact_manifest : {}
    entrypoint = manifest["entrypoint"].to_s
    return if entrypoint.blank?

    attachment = artifact_attachment_for(entrypoint)
    return unless attachment

    attachment.download.force_encoding("UTF-8")
  end

  def skip_sync_build?
    skip_sync_build == true
  end

  def set_html_source
    # For LaTeX projects, use the editor-converted PreTeXt body and wrap it
    # into a full document so docinfo/title are included in server builds.
    response = BuildServerClient.new.build_html(source: full_pretext_source, title: title)
    self.html_source = response.body
  end
end
