# frozen_string_literal: true

# Take divisions' sources apart into the fields of their elements -- type,
# title, label, other attributes -- and their bodies, by running the web-editor's
# own `splitDivisionSource` under Node (script/split-division-sources.mjs).
#
# A division's element used to be written in its source: a PreTeXt wrapper, a
# LaTeX `\section{...}\label{...}` header, Markdown frontmatter. It is built from
# columns now (see Content), and this is how source written the old way is read
# into them -- by the code that builds it back, so the two cannot disagree.
class DivisionSourceSplitter
  # Built by `npm run build:assembler`, beside SourceAssembler's bundle.
  BUNDLE = Rails.root.join("lib", "assembler", "split-divisions.mjs").freeze

  # Splitting is a scan, not a conversion: thousands of divisions take well
  # under a second. Like SourceAssembler's, this only guards a wedged process.
  TIMEOUT = 120

  # One division's source, taken apart. `xml_id` is the id the source itself
  # names, which may disagree with the record's ref; the ref wins.
  Result = Data.define(:id, :type, :title, :label, :xml_id, :attrs, :body, :wrapped, :warnings)

  # @param divisions [Enumerable<#id, #source, #source_format, #is_root>]
  # @param root_type [String] the type to give a root whose source names none
  # @param root_title [String] likewise its title
  # @return [Array<Result>] in the order given
  # @raise [NodeScript::Error]
  def self.call(divisions, root_type: "article", root_title: nil)
    input = divisions.map do |division|
      {
        id: division.id,
        source: division.source.to_s,
        source_format: division.source_format.to_s,
        fallback_type: division.is_root ? root_type : "section",
        fallback_title: (root_title if division.is_root)
      }
    end
    return [] if input.empty?

    output = NodeScript.new(BUNDLE, timeout: TIMEOUT).call(JSON.generate(input))
    JSON.parse(output).map { |result| Result.new(**result.symbolize_keys) }
  end
end
