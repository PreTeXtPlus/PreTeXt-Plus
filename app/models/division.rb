class Division < ApplicationRecord
  # touch: bumps source_updated_at *and* updated_at on the project. The editor saves
  # divisions through nested attributes, which leaves the projects row itself unchanged,
  # so without this neither "last edited" nor build staleness has a timestamp to trust.
  belongs_to :project, touch: :source_updated_at
  enum :source_format, { pretext: 0, latex: 1, markdown: 2 }, default: :pretext, suffix: true, validate: true

  validates :is_root, uniqueness: { scope: :project_id, message: "root division already exists for this project" }, if: :is_root?

  validates :ref, format: REF_REGEX, presence: true, uniqueness: { scope: :project }
  validate :ref_unique_among_assets

  before_create :set_default_source

  DEFAULT_PRETEXT_SOURCE = File.read Rails.root.join("app", "default_docs", "pretext.xml")
  DEFAULT_LATEX_SOURCE = File.read Rails.root.join("app", "default_docs", "latex.tex")
  DEFAULT_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "markdown.md")

  # A deck's starter needs its own file per markup style, not a shared one: the root
  # element differs (<slideshow> vs <article>), and so does the way each style spells a
  # slide -- LaTeX uses Beamer's `frame` environment, and Markdown shifts every heading
  # level down (`#` is a section, `##` a slide). Each starter carries one real slide,
  # both because an empty <slideshow> renders as a blank deck and because it is the
  # example of markup an author cannot be expected to guess.
  DEFAULT_SLIDESHOW_PRETEXT_SOURCE = File.read Rails.root.join("app", "default_docs", "slideshow.xml")
  DEFAULT_SLIDESHOW_LATEX_SOURCE = File.read Rails.root.join("app", "default_docs", "slideshow.tex")
  DEFAULT_SLIDESHOW_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "slideshow.md")

  def set_default_source
    unless source.present?
      if pretext_source_format?
        self.source = slideshow_root? ? DEFAULT_SLIDESHOW_PRETEXT_SOURCE : DEFAULT_PRETEXT_SOURCE
      elsif markdown_source_format?
        self.source = slideshow_root? ? DEFAULT_SLIDESHOW_MARKDOWN_SOURCE : DEFAULT_MARKDOWN_SOURCE
      else  # latex
        self.source = slideshow_root? ? DEFAULT_SLIDESHOW_LATEX_SOURCE : DEFAULT_LATEX_SOURCE
      end
    end
  end

  private

  # Only the *root* division of a slideshow gets the deck starter. A non-root division
  # is a <section>, which is spelled the same either way, and handing it a second
  # <slideshow> root would be invalid markup.
  def slideshow_root?
    is_root? && project&.slideshow_document_type?
  end

  def ref_unique_among_assets
    return unless project_id && ref

    if Asset.where(project_id: project_id, ref: ref).exists?
      errors.add(:ref, "has already been taken")
    end
  end
end
