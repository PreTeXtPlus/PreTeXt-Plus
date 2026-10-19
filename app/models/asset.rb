class Asset < ApplicationRecord
  include HasUniqueRef
  ref_sibling_classes "Division", "Snippet"

  # See Division: a build consumes assets too, so changing one makes built targets stale.
  belongs_to :project, touch: :source_updated_at
  # For a `file` asset, the upload. For a `generated` asset, the primary output: the
  # SVG the editor (or a server render) produced from `source`.
  has_one_attached :file
  # The other files PreTeXt's generated directory holds for a generated asset --
  # `-annotations.xml`, `-diagcess.svg`, later `.pdf`/`.png`. Each blob's filename is
  # the *suffix* alone ("-annotations.xml"), never the ref: the full name is derived in
  # #generated_files, so a renamed asset renames its outputs for free and a blob shared
  # by Project#full_dup serves both copies under their own refs.
  has_many_attached :renditions

  # `generated` (docs/generated-assets-plan.md): authored source in `source` for a
  # `generator`, plus the files that generator would produce, attached as `file` and
  # `renditions`. Additive -- integer enums are never renumbered.
  enum :kind, {
    file: 0,
    authored: 1,
    generated: 2
  }, suffix: true

  GENERATORS = %w[ prefigure ].freeze
  validates :generator, inclusion: { in: GENERATORS }, if: :generated_kind?
  validates :generator, absence: true, unless: :generated_kind?
  validate :generated_outputs_are_well_formed, if: :generated_kind?

  # The docinfo elements each generator's render depends on, besides the asset's own
  # source. Core writes these into the generator's publication file for a real build
  # (extract-prefigure.xsl), so a change to them is a change to the picture.
  #
  # Mirrored in packages/web-editor/src/generators/renderInput.ts; the two must digest
  # byte-identical strings, which test/models/asset_test.rb and the web-editor's
  # generators test both pin to one fixture hex.
  DOCINFO_INPUT_ELEMENTS = { "prefigure" => %w[ macros prefigure-preamble ] }.freeze
  RENDER_INPUT_SEPARATOR = "\n\u0000\n".freeze

  # A rendition's filename is a suffix: an optional `-word` then an extension.
  RENDITION_SUFFIX = /\A(?:-[a-z0-9]+)?\.[a-z0-9]+\z/
  GENERATED_CONTENT_TYPES = %w[ image/svg+xml application/xml text/xml application/pdf image/png ].freeze

  # The cap applies only when adding a new asset: an account already over its
  # limit (subscription lapsed) keeps its existing assets rather than being
  # forced to delete them (see Collaboration#within_collaborator_limit for the
  # identical grandfathering rule).
  # Never for a backup's assets: taking a backup re-attaches blobs the account
  # already holds, and must not fail -- or count -- against the cap.
  validate :within_asset_quota, on: :create, if: -> { project.present? && !project.backup? }

  # Rails forces SVGs to download rather than display inline by default,
  # since an SVG can carry a <script> (a stored-XSS precaution). This asset's
  # file is only ever rendered via `<img src>` in the asset manager/editor,
  # which never executes embedded scripts, so it's safe to bypass that
  # default here. Scoped to this method (rather than the app-wide Rails
  # config) rather than changing the default for every blob URL app-wide.
  # See ServesBuildFiles::INLINE_OVERRIDE_CONTENT_TYPES for the same override
  # applied to build output.
  INLINE_OVERRIDE_CONTENT_TYPES = %w[ image/svg+xml ].freeze

  # Recognized image content types and the extension each maps to. Matches
  # ActiveStorage.variable_content_types (what #thumbnailable? treats as
  # rasterable) plus svg+xml (INLINE_OVERRIDE_CONTENT_TYPES) -- anything this
  # app will ever thumbnail or inline-serve has a known extension here too.
  CONTENT_TYPE_EXTENSIONS = {
    "image/png" => "png",
    "image/gif" => "gif",
    "image/jpeg" => "jpg",
    "image/tiff" => "tiff",
    "image/bmp" => "bmp",
    "image/vnd.adobe.photoshop" => "psd",
    "image/vnd.microsoft.icon" => "ico",
    "image/webp" => "webp",
    "image/avif" => "avif",
    "image/heic" => "heic",
    "image/heif" => "heif",
    "image/svg+xml" => "svg"
  }.freeze

  # The bare filename extension (no leading dot) inferred from the attached
  # file's content type -- never from the uploaded filename, which a browser
  # paste can't supply reliably (the web-editor renames a pasted image's file
  # to a bare, extensionless placeholder before it ever reaches here). Nil
  # when there's no file, or its content type isn't a recognized image type.
  def file_extension
    CONTENT_TYPE_EXTENSIONS[file_content_type] if file.attached?
  end

  # The attached file's MIME type (e.g. "image/png"), or nil when there's no
  # file. Delegates through the attachment proxy to the blob.
  def file_content_type
    file.content_type if file.attached?
  end

  # The filename this asset is presented as everywhere outside its own byte
  # storage: "REF.EXT" (or bare REF if the content type isn't recognized).
  # Single source of truth for every place that names this asset's file for
  # external consumption -- ProjectArchiveBuilder's external/ entry, the EPUB
  # cover picker, and this asset's own download/inline Content-Disposition
  # (`url`, below) all call this instead of re-deriving a filename
  # themselves. Computed fresh from `ref` + `file_extension` rather than read
  # off the stored blob filename, since the same blob can be shared by
  # multiple Asset rows with different refs (see Project#full_dup).
  def external_filename
    return nil unless file.attached?

    file_extension ? "#{ref}.#{file_extension}" : ref
  end

  def url
    return "/image-not-found.svg" unless file.present?

    blob = file.blob
    # use 1.hour to avoid clock skew
    if INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type)
      blob.service.url(blob.key, expires_in: 1.hour, filename: ActiveStorage::Filename.new(external_filename),
        content_type: blob.content_type, disposition: :inline)
    else
      file.url(expires_in: 1.hour, filename: external_filename)
    end
  end

  THUMBNAIL_SIZE = [ 200, 200 ].freeze

  # The exact string whose sha256 is `output_source_digest`: the source, then the inner
  # text of each docinfo element the generator reads, joined by a separator no author
  # would type. Read with a regex rather than parsed, so the browser (which has only the
  # docinfo string) can produce the same bytes without agreeing with Nokogiri about
  # serialization.
  def render_input(docinfo = project&.effective_docinfo)
    parts = [ source.to_s ]
    DOCINFO_INPUT_ELEMENTS.fetch(generator.to_s, []).each do |element|
      parts << self.class.docinfo_element_inner(docinfo.to_s, element)
    end
    parts.join(RENDER_INPUT_SEPARATOR)
  end

  def self.docinfo_element_inner(docinfo, element)
    name = Regexp.escape(element)
    match = docinfo.match(/<#{name}(?:\s[^>]*)?>([\s\S]*?)<\/#{name}>/)
    match ? match[1] : ""
  end

  # Whether the attached outputs were built from the source (and docinfo) as they are
  # now. `output_source_digest` is a claim the client made; this is the check every
  # consumer of an output must make, never a boolean read off the row.
  def output_current?
    generated_kind? && file.attached? && output_source_digest.present? &&
      output_source_digest == Digest::SHA256.hexdigest(render_input)
  end

  # Every file this asset contributes to PreTeXt's generated directory, as
  # `filename => blob`, named exactly as a `pretext generate` run would name them:
  # `<ref>.svg` and `<ref><suffix>` for each rendition. Empty for anything but a generated
  # asset with an output.
  def generated_files
    return {} unless generated_kind? && file.attached?

    files = { "#{ref}.svg" => file.blob }
    # Sorted so the archive and the JSON list them in one stable order.
    renditions.sort_by { |rendition| rendition.filename.to_s }.each do |rendition|
      files["#{ref}#{rendition.filename}"] = rendition.blob
    end
    files
  end

  # Whether `thumbnail_url` has anything to show: no file, or a file type
  # ActiveStorage can't raster a variant of, means no preview -- callers fall
  # back to a generic file icon. Cheap (no processing), so it's safe to call
  # from JSON rendering to decide whether to advertise a thumbnail path at
  # all, without paying for `thumbnail_url`'s variant processing there.
  def thumbnailable?
    return false unless file.present?

    blob = file.blob
    INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type) || blob.variable?
  end

  # A small preview URL for the asset manager/editor list and the project
  # dashboard, distinct from `url` (the full file, used for the actual
  # `<image>` embed). Nil when `thumbnailable?` is false. SVGs are already
  # tiny/vector, so they skip variant processing and reuse the full `url`
  # directly; everything else is resized through a real ActiveStorage variant
  # (processed synchronously here, so only call this where that cost is
  # acceptable -- e.g. the dedicated thumbnail redirect action, not JSON
  # rendering of a list).
  def thumbnail_url
    return nil unless thumbnailable?

    blob = file.blob
    return url if INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type)

    file.variant(resize_to_limit: THUMBNAIL_SIZE).processed.url(expires_in: 1.hour)
  end

  private

  # A generated asset's outputs are whatever a generator writes, so the only guard is
  # that they are the kinds of file one writes: an SVG primary, and renditions named by a
  # suffix (#renditions) in a type PreTeXt's generated directory can hold.
  def generated_outputs_are_well_formed
    if file.attached? && file.blob&.content_type != "image/svg+xml"
      errors.add(:file, "of a generated asset must be an SVG")
    end
    renditions.each do |rendition|
      name = rendition.filename.to_s
      errors.add(:renditions, "#{name} is not an output suffix like -annotations.xml") unless name.match?(RENDITION_SUFFIX)
      unless GENERATED_CONTENT_TYPES.include?(rendition.blob&.content_type)
        errors.add(:renditions, "#{name} has an unsupported content type")
      end
    end
  end

  # Keyed to the project OWNER, not whoever is actually uploading -- an
  # asset's storage cost belongs to whoever's account it lives in, exactly
  # like Project#collaborator_limit follows the owner rather than the inviter.
  def within_asset_quota
    owner = project.user
    if owner.present? && owner.assets.count >= owner.asset_quota
      errors.add(:base, "Asset limit (#{owner.asset_quota}) reached for this account")
    end
  end
end
