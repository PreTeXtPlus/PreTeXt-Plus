# frozen_string_literal: true

# Move every division's element out of its source and into columns.
#
# A division's type, title, xml:id and attributes used to be written in
# its source, in its own markup style -- a PreTeXt wrapper element, a LaTeX
# `\section{...}\label{...}` header, Markdown frontmatter -- and the editor
# rewrote that source for every metadata edit. They are columns now, and the
# source is the body alone; assembly builds the element from the columns.
#
# The splitting is done by the web-editor's own `splitDivisionSource`, through
# DivisionSourceSplitter, so it reads these sources exactly as the code that
# writes the element back would. The body comes back byte for byte apart from
# blank lines at its ends.
#
# Columns are overwritten, not filled in: until this runs, a division's source
# was its truth, and anything already in them came from a collaborative
# document's copy of what the source said.
#
# A root with no element of its own (a bare fragment, or a LaTeX/Markdown root
# with no header) takes its type from the project's root element -- the type
# the editor last saw it as -- or failing that its document type, and its title
# from the project's. Any other division with none -- a LaTeX introduction or
# conclusion, whose markup has no header command, so its source never named its
# type -- takes the type of the placeholder that places it, which is the one
# durable record of what it is; one nothing places is a section. That is why a
# project's divisions go to the splitter together rather than in batches: the
# placeholder is in the parent's source.
class SplitDivisionMetadataOutOfSources < ActiveRecord::Migration[8.1]
  class MigrationContent < ActiveRecord::Base
    self.table_name = "contents"
    # The splitter reads a format by name.
    enum :source_format, { pretext: 0, latex: 1, markdown: 2 }
  end

  class MigrationProject < ActiveRecord::Base
    self.table_name = "projects"
  end

  DIVISION = 0
  DOCUMENT_TYPES = %w[ article book slideshow ].freeze

  def up
    split = wrapped = 0
    warnings = []

    say_with_time "splitting division metadata out of sources" do
      MigrationProject.unscoped.select(:id, :title, :document_type, :root_element).find_each do |project|
        divisions = MigrationContent.where(project_id: project.id, kind: DIVISION).to_a
        root_type = project.root_element.presence_in(DOCUMENT_TYPES) || DOCUMENT_TYPES.fetch(project.document_type.to_i, "article")

        results = DivisionSourceSplitter.call(divisions, root_type: root_type, root_title: project.title)
        divisions.zip(results).each do |division, result|
          division.update_columns(
            source: result.body,
            division_type: result.type,
            title: result.title,
            attrs: result.attrs
          )
          split += 1
          wrapped += 1 if result.wrapped
          if result.xml_id.present? && result.xml_id != division.ref
            warnings << "#{division.id}: source named xml:id #{result.xml_id.inspect}, kept ref #{division.ref.inspect}"
          end
          warnings.concat(result.warnings.map { |warning| "#{division.id}: #{warning}" })
        end
      end
      split
    end

    say "#{split} divisions split, #{wrapped} of them carrying their own element", true
    warnings.each { |warning| say warning, true }

    add_check_constraint :contents, "kind <> #{DIVISION} OR division_type IS NOT NULL", name: "contents_division_has_a_type"
  end

  # The sources are gone in the shape this read them from; the columns hold
  # everything that was in them, but writing the elements back is the editor's
  # job (`wrapDivisionSource`), not a migration's.
  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
