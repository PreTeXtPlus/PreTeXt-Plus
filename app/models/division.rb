class Division < ApplicationRecord
  belongs_to :project
  enum :source_format, { pretext: 0, latex: 1, markdown: 2 }, default: :pretext, suffix: true, validate: true
  DEFAULT_PRETEXT_SOURCE = File.read Rails.root.join("app", "default_docs", "pretext.xml")
  DEFAULT_LATEX_SOURCE = File.read Rails.root.join("app", "default_docs", "latex.tex")
  DEFAULT_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "markdown.md")

  def set_default_source
    if pretext_source_format?
      self.source = DEFAULT_PRETEXT_SOURCE
    elsif markdown_source_format?
      self.source  = DEFAULT_MARKDOWN_SOURCE
    else  # latex
      self.source = DEFAULT_LATEX_SOURCE
    end
  end
end
