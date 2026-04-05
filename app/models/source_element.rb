class SourceElement < ApplicationRecord
  belongs_to :project
  belongs_to :parent, class_name: "SourceElement", optional: true
  has_many :children, class_name: "SourceElement", foreign_key: :parent_id, dependent: :destroy

  validates :element_type, presence: true, inclusion: {
    in: %w[
      docinfo frontmatter backmatter
      chapter section subsection
      introduction conclusion
      preface appendix colophon references
    ]
  }
  validates :position, presence: true,
    uniqueness: { scope: [ :project_id, :parent_id ] },
    numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  default_scope { order(:position) }

  TITLE_BEARING_TYPES = %w[chapter section subsection preface appendix].freeze

  def container?
    children.any?
  end

  def content?
    !container?
  end

  def title_bearing?
    element_type.in?(TITLE_BEARING_TYPES)
  end

  # Recursively build the PreTeXt XML for this element and its descendants.
  def to_xml
    xml = +"<#{element_type}>"
    xml << "<title>#{title}</title>" if title.present? && title_bearing?

    if container?
      children.each { |child| xml << child.to_xml }
    else
      xml << source.to_s
    end

    xml << "</#{element_type}>"
    xml
  end
end
