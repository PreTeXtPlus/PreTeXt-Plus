# What makes a Content a generated asset: an authored asset whose `source_format`
# is a generator's (PreFigure, TikZ), so its `source` is that generator's input --
# a `<diagram>` or a `tikzpicture`, not PreTeXt. The format is chosen when the asset is created and
# decides how the editor treats it (its preview engine, its tooling) and how it is
# assembled: the document carries the source wrapped in the generator's own
# element (see the web-editor's generator registry), and a build generates the
# picture from that like any other PreTeXt image, with the build server's own
# cache deciding whether to rerun the generator.
#
# The editor renders it in the browser too, storing the SVG as the content's file
# so the asset list, a peer without an engine and a reload all have a picture.
# That picture is a preview, never a build input. `preview_input_digest` is a
# claim the client made about which input it matches; #preview_current? is the
# check, and nothing reads a boolean off the row.
module Content::GeneratedAssetBehavior
  extend ActiveSupport::Concern

  # Each generator's format, and the PreTeXt element its source is wrapped in --
  # also the directory under `generated/` a renderer puts the picture in.
  ELEMENTS = { "prefigure" => "prefigure", "tikz" => "latex-image" }.freeze

  # The docinfo elements each generator's render depends on, besides the asset's own
  # source. Core writes these into the generator's publication file or the image's
  # LaTeX document for a real build (extract-prefigure.xsl, extract-latex-image.xsl), so
  # a change to them is a change to the picture.
  #
  # Mirrored in packages/web-editor/src/generators/renderInput.ts; the two must digest
  # byte-identical strings, which test/models/content_test.rb and the web-editor's
  # generators test both pin to one fixture hex.
  DOCINFO_INPUT_ELEMENTS = {
    "prefigure" => %w[ macros prefigure-preamble ],
    "tikz" => %w[ macros latex-image-preamble ]
  }.freeze
  RENDER_INPUT_SEPARATOR = "\n\u0000\n".freeze

  included do
    validates :source_format, inclusion: { in: [ "pretext", *ELEMENTS.keys ] }, if: :authored_asset?
    validate :preview_is_svg, if: :generated_asset?
  end

  class_methods do
    # The raw inner text of the first `<element …>…</element>` in `docinfo` without
    # `@syntax`, or "". Core reads only such a `<latex-image-preamble>`; one with `@syntax`
    # belongs to some other image language. A regex rather than a parse, so the browser
    # (which has only the docinfo string) can produce the same bytes without agreeing
    # with Nokogiri about serialization.
    def docinfo_element_inner(docinfo, element)
      name = Regexp.escape(element)
      match = docinfo.match(/<#{name}(?![^>]*\ssyntax\s*=)(?:\s[^>]*)?>([\s\S]*?)<\/#{name}>/)
      match ? match[1] : ""
    end
  end

  def generated_asset?
    authored_asset? && ELEMENTS.key?(source_format)
  end

  # The element this asset's source is wrapped in, or nil for anything but a
  # generated asset.
  def generated_element
    ELEMENTS[source_format] if generated_asset?
  end

  # The exact string whose sha256 is `preview_input_digest`: the source, then the inner
  # text of each docinfo element the generator reads, joined by a separator no author
  # would type.
  def render_input(docinfo = project&.effective_docinfo)
    parts = [ source.to_s ]
    DOCINFO_INPUT_ELEMENTS.fetch(source_format.to_s, []).each do |element|
      parts << self.class.docinfo_element_inner(docinfo.to_s, element)
    end
    parts.join(RENDER_INPUT_SEPARATOR)
  end

  # Whether the stored picture was rendered from the source (and docinfo) as they are now.
  def preview_current?
    generated_asset? && file_attached? && preview_input_digest.present? &&
      preview_input_digest == Digest::SHA256.hexdigest(render_input)
  end

  private

  def preview_is_svg
    if file_attached? && file_content_type != "image/svg+xml"
      errors.add(:files, "of a generated asset must be an SVG")
    end
  end
end
