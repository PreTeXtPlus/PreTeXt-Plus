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

  # Valid child types for each container element type.
  CHILD_TYPES = {
    "frontmatter" => %w[preface colophon],
    "backmatter"  => %w[appendix colophon references],
    "chapter"     => %w[introduction section conclusion],
    "section"     => %w[subsection],
    "appendix"    => %w[subsection]
  }.freeze

  # Top-level element types that can be added at the root of a project.
  ROOT_TYPES = %w[docinfo frontmatter chapter section backmatter].freeze

  def container?
    children.any?
  end

  def content?
    !container?
  end

  def title_bearing?
    element_type.in?(TITLE_BEARING_TYPES)
  end

  # Returns the child types allowed for this element, or empty if it can't have children.
  def allowed_child_types
    CHILD_TYPES.fetch(element_type, [])
  end

  # Returns the next available position among siblings.
  def next_sibling_position
    siblings = project.source_elements.where(parent_id: parent_id)
    (siblings.maximum(:position) || -1) + 1
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
