class Project < ApplicationRecord
  belongs_to :user
  has_many :source_elements, dependent: :destroy

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

  # Recursively assembles the full PreTeXt XML document from source_elements.
  # Falls back to the legacy `source` column if no elements exist yet.
  def assemble_source
    root_elements = source_elements.where(parent_id: nil).order(:position)
    return source if root_elements.empty?

    doc_tag = document_type || "article"

    xml = +"<pretext>"
    docinfo = root_elements.find { |e| e.element_type == "docinfo" }
    xml << docinfo.to_xml if docinfo

    xml << "<#{doc_tag}>"
    xml << "<title>#{title}</title>" if title.present?

    root_elements.reject { |e| e.element_type == "docinfo" }.each do |element|
      xml << element.to_xml
    end

    xml << "</#{doc_tag}>"
    xml << "</pretext>"
    xml
  end

  # Assembles source from elements into the project's source column and
  # triggers the build server (via the before_update callback).
  def reassemble_and_build!
    assembled = assemble_source
    update!(source: assembled)
  end

  # Scaffolds the default source_elements tree for a new project.
  def scaffold_elements!
    content = self.class.default_content_for(source_format)

    case document_type.to_s
    when "book"
      source_elements.create!(element_type: "frontmatter", position: 0)
      chapter = source_elements.create!(element_type: "chapter", title: "Chapter 1", position: 1)
      source_elements.create!(
        element_type: "section", title: "Welcome", source: content,
        parent: chapter, position: 0
      )
      source_elements.create!(element_type: "backmatter", position: 2)
    else
      # article / slideshow / default: single section
      source_elements.create!(
        element_type: "section", title: "Welcome", source: content, position: 0
      )
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
    # Use assembled source from elements when available, otherwise fall back
    # to the legacy source column (for LaTeX, prefer pretext_source if present).
    build_source = if source_elements.where(parent_id: nil).any?
      assemble_source
    elsif latex_source_format? && pretext_source.present?
      pretext_source
    else
      source
    end
    params = {
      source: build_source,
      title: self.title,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)
    self.html_source = response.body
  end
end
