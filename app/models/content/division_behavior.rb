# What makes a Content a division: a place in the document tree, an element
# type, and -- for exactly one per project -- being the document's root.
module Content::DivisionBehavior
  extend ActiveSupport::Concern

  # Every PreTeXt element a division can be. Mirrors `DivisionType` in
  # packages/web-editor/src/types/sections.ts, which is what the editor offers
  # and what assembly writes as the element's tag; ContentTest parses that file
  # so the two cannot drift.
  DIVISION_TYPES = %w[
    book article slideshow
    part chapter
    section subsection subsubsection introduction conclusion worksheet handout
    exercises references glossary solutions reading-questions paragraphs
    frontmatter preface acknowledgement dedication biography contributors
    backmatter appendix index colophon
  ].freeze

  DEFAULT_SOURCES = {
    pretext: "pretext.xml", latex: "latex.tex", markdown: "markdown.md"
  }.transform_values { |name| File.read(Rails.root.join("app", "default_docs", name)) }.freeze

  # A deck's starter needs its own body per markup style, not a shared one: each
  # style spells a slide differently -- LaTeX uses Beamer's `frame` environment,
  # Markdown a `##` heading (the frontmatter assembly writes makes `#` a section).
  # Each starter carries one real slide, both because an empty <slideshow>
  # renders as a blank deck and because it is the example of markup an author
  # cannot be expected to guess.
  DEFAULT_SLIDESHOW_SOURCES = {
    pretext: "slideshow.xml", latex: "slideshow.tex", markdown: "slideshow.md"
  }.transform_values { |name| File.read(Rails.root.join("app", "default_docs", name)) }.freeze

  # The reader-facing title a new document starts with, per markup style, so
  # the starter says which style the author picked. Distinct from the project's
  # own title, which is the author's name for it in their dashboard.
  DEFAULT_ROOT_TITLES = {
    pretext: "New PreTeXt XML document",
    latex: "New LaTeX-style PreTeXt document",
    markdown: "New Markdown-style PreTeXt document"
  }.freeze

  DEFAULT_SLIDESHOW_ROOT_TITLES = {
    pretext: "New PreTeXt slideshow",
    latex: "New LaTeX-style PreTeXt slideshow",
    markdown: "New Markdown-style PreTeXt slideshow"
  }.freeze

  included do
    # Before validation, so a division built without a type -- by a caller that
    # predates the column, or a collaborative document projected from before it
    # existed -- is given the one its place implies rather than refused.
    before_validation :set_default_division_type, if: :division?
    before_create :set_default_source, if: :division?

    with_options if: :division? do
      validates :division_type, inclusion: { in: DIVISION_TYPES }
      validates :division_type, inclusion: {
        in: Project::ROOT_ELEMENT_TYPES, message: "must be a document root element"
      }, if: :is_root?

      # A project has exactly one root division, and nothing done to a division
      # may change that. At most one: this validation, backed by a partial
      # unique index. At least one: a root can neither stop being the root, move
      # to another project, nor be destroyed except along with its project.
      # Project ensures every new project starts with one (see
      # Project#build_root_division).
      validates :is_root, uniqueness: { scope: :project_id, message: "root division already exists for this project" }, if: :is_root?
      validate :root_and_project_unchanged, on: :update
    end
    validates :is_root, absence: { message: "is only for divisions" }, unless: :division?

    # destroyed_by_association is set only when the project's `dependent:
    # :destroy` cascades here -- that is, when the project itself is going.
    before_destroy :keep_root, if: :division?, unless: :destroyed_by_association
  end

  private

  def set_default_division_type
    self.division_type ||= is_root? ? (project&.document_type || "article") : "section"
  end

  # A new document's starter: a root with nothing in it yet gets the body and
  # title of its markup style's starter. Anything else starts as it was given.
  def set_default_source
    return unless is_root?

    format = source_format.to_sym
    if source.blank?
      self.source = (slideshow_root? ? DEFAULT_SLIDESHOW_SOURCES : DEFAULT_SOURCES).fetch(format)
    end
    if title.blank?
      self.title = (slideshow_root? ? DEFAULT_SLIDESHOW_ROOT_TITLES : DEFAULT_ROOT_TITLES).fetch(format)
    end
  end

  def root_and_project_unchanged
    errors.add(:is_root, "cannot be changed") if will_save_change_to_is_root?
    errors.add(:project, "cannot be changed") if will_save_change_to_project_id?
  end

  def keep_root
    return unless is_root?

    errors.add(:base, "The root division cannot be deleted")
    throw :abort
  end

  # Only the *root* division of a slideshow gets the deck starter. A non-root
  # division is a <section>, which is spelled the same either way.
  def slideshow_root?
    is_root? && project&.slideshow_document_type?
  end
end
