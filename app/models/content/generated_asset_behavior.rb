# What makes a Content a generated asset: authored `source` for a `generator`
# (PreFigure first) that the editor renders in the browser, storing the resulting
# SVG as the content's file so the asset list, a peer without an engine and a
# reload all have a picture. The document itself carries only the source, wrapped
# in the generator's own element (see the web-editor's generator registry); a
# build generates the picture from that like any other PreTeXt asset, with the
# build server's own cache deciding whether to rerun the generator. The stored
# picture is a preview, never a build input.
#
# `output_source_digest` is a claim the client made about which input its picture
# matches. #output_current? is the check; nothing reads a boolean off the row.
module Content::GeneratedAssetBehavior
  extend ActiveSupport::Concern

  GENERATORS = %w[ prefigure ].freeze

  # The docinfo elements each generator's render depends on, besides the asset's own
  # source. Core writes these into the generator's publication file for a real build
  # (extract-prefigure.xsl), so a change to them is a change to the picture.
  #
  # Mirrored in packages/web-editor/src/generators/renderInput.ts; the two must digest
  # byte-identical strings, which test/models/content_test.rb and the web-editor's
  # generators test both pin to one fixture hex.
  DOCINFO_INPUT_ELEMENTS = { "prefigure" => %w[ macros prefigure-preamble ] }.freeze
  RENDER_INPUT_SEPARATOR = "\n\u0000\n".freeze

  included do
    validates :generator, inclusion: { in: GENERATORS }, if: :generated_asset?
    validates :generator, absence: true, unless: :generated_asset?
    validate :generated_output_is_svg, if: :generated_asset?
  end

  class_methods do
    # The raw inner text of the first `<element …>…</element>` in `docinfo`, or "".
    # A regex rather than a parse, so the browser (which has only the docinfo string)
    # can produce the same bytes without agreeing with Nokogiri about serialization.
    def docinfo_element_inner(docinfo, element)
      name = Regexp.escape(element)
      match = docinfo.match(/<#{name}(?:\s[^>]*)?>([\s\S]*?)<\/#{name}>/)
      match ? match[1] : ""
    end
  end

  # The exact string whose sha256 is `output_source_digest`: the source, then the inner
  # text of each docinfo element the generator reads, joined by a separator no author
  # would type.
  def render_input(docinfo = project&.effective_docinfo)
    parts = [ source.to_s ]
    DOCINFO_INPUT_ELEMENTS.fetch(generator.to_s, []).each do |element|
      parts << self.class.docinfo_element_inner(docinfo.to_s, element)
    end
    parts.join(RENDER_INPUT_SEPARATOR)
  end

  # Whether the stored picture was rendered from the source (and docinfo) as they are now.
  def output_current?
    generated_asset? && file_attached? && output_source_digest.present? &&
      output_source_digest == Digest::SHA256.hexdigest(render_input)
  end

  private

  def generated_output_is_svg
    if file_attached? && file_content_type != "image/svg+xml"
      errors.add(:files, "of a generated asset must be an SVG")
    end
  end
end
