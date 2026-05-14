class Project < ApplicationRecord
  belongs_to :user

  enum :source_format, { pretext: 0, latex: 1, markdown: 2 }, default: :pretext, suffix: true, validate: true
  enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true

  before_update :set_html_source

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

  DEFAULT_DOCINFO = File.read Rails.root.join("app", "default_docs", "docinfo.xml")
  DEFAULT_PRETEXT_SOURCE = File.read Rails.root.join("app", "default_docs", "pretext.xml")
  DEFAULT_LATEX_SOURCE = File.read Rails.root.join("app", "default_docs", "latex.tex")
  DEFAULT_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "markdown.md")

  private

  def set_html_source
    require "uri"
    require "net/http"
    # For LaTeX projects, use the editor-converted PreTeXt body and wrap it
    # into a full document so docinfo/title are included in server builds.
    params = {
      source: full_pretext_source,
      title: self.title,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)
    self.html_source = response.body
  end
end
