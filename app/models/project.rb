class Project < ApplicationRecord
  belongs_to :user

  enum :source_format, { pretext: 0, latex: 1, pmd: 2 }, suffix: true
  enum :document_type, { article: 0, book: 1, slideshow: 2 }, suffix: true

  before_update :set_html_source

  default_scope { order(updated_at: :desc) }

  # Wraps the project source in a full PreTeXt document, including docinfo.
  def full_pretext_source
    if latex_source_format? && pretext_source.blank?
      return source.to_s
    end
    doc_tag = document_type || "article"

    xml = +"<pretext>"
    xml << docinfo.to_s if docinfo.present?
    xml << "<#{doc_tag} label=\"article\">"
    xml << "<title>#{title}</title>" if title.present?
    xml << (latex_source_format? ? pretext_source.to_s : source.to_s)
    xml << "</#{doc_tag}>"
    xml << "</pretext>"
    xml
  end

  def self.default_docinfo
    DEFAULT_DOCINFO
  end

  def set_default_source
    if pretext_source_format?
      self.source = DEFAULT_PRETEXT_SOURCE
    elsif pmd_source_format?
      self.source  = DEFAULT_PMD_SOURCE
    else  # latex
      self.source = DEFAULT_LATEX_SOURCE
    end
  end

  def set_default_docinfo
    self.docinfo = DEFAULT_DOCINFO
  end

  def to_h
    [ :title, :source, :source_format, :pretext_source, :docinfo ]
      .map { |attr| [ attr, self.send(attr) ] }.to_h
  end

  DEFAULT_DOCINFO = <<~XML
    <docinfo>
      <brandlogo source="icon.svg" />
    </docinfo>
  XML

  DEFAULT_PRETEXT_SOURCE = <<~XML
    <section>
      <title> Welcome to PreTeXt.Plus! </title>

      <p>
        This is a sample project to get you started. You can edit this content using the PreTeXt markup language.
        <me>
          \\left|\\sum_{i=0}^n a_i\\right|\\leq\\sum_{i=0}^n|a_i|
        </me>
      </p>

      <fact>
        <statement>
          <p>
            For more information on how to use PreTeXt, please visit <c>https://pretextbook.org/doc/guide/html/</c>.
          </p>
        </statement>
      </fact>

      <p>
        Feel free to delete this sample content and start creating your own project. Happy writing!
      </p>
    </section>
  XML

  DEFAULT_LATEX_SOURCE = <<~LATEX
    \\section{Welcome to PreTeXt.Plus!}

    This is a sample project to get you started. You can edit this content using markup that should
    look just like LaTeX. For example, you can write math using LaTeX syntax:

    \\[
      \\left|\\sum_{i=0}^n a_i\\right| \\leq \\sum_{i=0}^n |a_i|
    \\]

    Not all LaTeX is supported, but that's a good thing.  Writing in LaTeX-style PreTeXt will ensure your content can be built by PreteXt and will be accessible!

    Feel free to delete this sample content and start creating your own project. Happy writing!
  LATEX

  DEFAULT_PMD_SOURCE = <<~PMD
    # Welcome to PreTeXt.Plus!

    This is a sample project to get you started. You can edit this content using PreTeXt Markdown.

    $$
      \\left|\\sum_{i=0}^n a_i\\right| \\leq \\sum_{i=0}^n |a_i|
    $$

    For more information, visit https://pretextbook.org/doc/guide/html/.

    Feel free to delete this sample content and start creating your own project. Happy writing!
  PMD

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
