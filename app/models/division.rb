class Division < ApplicationRecord
  belongs_to :project
  enum :source_format, { pretext: 0, latex: 1, markdown: 2 }, default: :pretext, suffix: true, validate: true

  validates :is_root, uniqueness: { scope: :project_id, message: "root division already exists for this project" }, if: :is_root?

  validates :ref, format: REF_REGEX, presence: true, uniqueness: { scope: :project }
  validate :ref_unique_among_project_assets

  before_create :set_default_source

  DEFAULT_PRETEXT_SOURCE = File.read Rails.root.join("app", "default_docs", "pretext.xml")
  DEFAULT_LATEX_SOURCE = File.read Rails.root.join("app", "default_docs", "latex.tex")
  DEFAULT_MARKDOWN_SOURCE = File.read Rails.root.join("app", "default_docs", "markdown.md")

  def set_default_source
    unless source.present?
      if pretext_source_format?
        self.source = DEFAULT_PRETEXT_SOURCE
      elsif markdown_source_format?
        self.source  = DEFAULT_MARKDOWN_SOURCE
      else  # latex
        self.source = DEFAULT_LATEX_SOURCE
      end
    end
  end

  private

  def ref_unique_among_project_assets
    return unless project_id && ref

    if ProjectAsset.where(project_id: project_id, ref: ref).exists?
      errors.add(:ref, "has already been taken")
    end
  end
end
