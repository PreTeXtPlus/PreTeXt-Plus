class Project < ApplicationRecord
  belongs_to :user

  enum :source_format, { pretext: 0, latex: 1, pmd: 2 }, suffix: true
  enum :document_type, { article: 0, book: 1, slideshow: 2 }, suffix: true

  before_update :set_html_source

  default_scope { order(updated_at: :desc) }

  def self.default_content_for(source_format)
    case source_format.to_s
    when "latex"
      DEFAULT_LATEX_CONTENT
    when "pmd"
      DEFAULT_PMD_CONTENT
    else
      DEFAULT_PRETEXT_CONTENT
    end
  end

  DEFAULT_PRETEXT_CONTENT = <<~XML
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

  DEFAULT_LATEX_CONTENT = <<~LATEX
    \\section{Welcome to PreTeXt.Plus!}

    This is a sample project to get you started. You can edit this content using \\latex.

    \\[
      \\left|\\sum_{i=0}^n a_i\\right| \\leq \\sum_{i=0}^n |a_i|
    \\]

    For more information, visit \\url{https://pretextbook.org/doc/guide/html/}.

    Feel free to delete this sample content and start creating your own project. Happy writing!
  LATEX

  DEFAULT_PMD_CONTENT = <<~PMD
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
    # For LaTeX projects, use the editor-converted PreTeXt content for building;
    # fall back to raw content if the conversion hasn't been stored yet.
    build_source = (latex_source_format? && pretext_source.present?) ? pretext_source : source
    params = {
      source: build_source,
      title: self.title,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)
    self.html_source = response.body
  end
end
