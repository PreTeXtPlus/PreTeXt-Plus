# One piece of a project's content: a division of the document, a snippet, or
# an asset. `kind` says which.
#
# They share a table because they share almost everything that matters: every
# one is named by a `ref` that a `<plus:* ref="..."/>` placeholder elsewhere in
# the project resolves against, in a single namespace (the placeholder's tag,
# not the ref, says which kind it expects), so refs are unique per project
# across all kinds -- one unique index rather than three tables checking each
# other by hand. Each carries a `source` in some format, and a build consumes
# all of them.
#
# A record's metadata lives in columns, never in its source. In particular a
# division's `source` is its *body*: its element -- type, title, xml:id and
# label (both its ref) and any other attributes -- is built from the columns when the
# project is assembled (see the web-editor's `wrapDivisionSource`), in all three
# markup styles.
#
# Kind-specific rules live in Content::DivisionBehavior, Content::AssetBehavior
# and Content::GeneratedAssetBehavior (an authored asset in a generator's
# format), each applying only to its own records; serving attached files is
# Content::AttachedFiles, for every kind.
class Content < ApplicationRecord
  include Content::AttachedFiles
  include Content::DivisionBehavior
  include Content::AssetBehavior
  include Content::GeneratedAssetBehavior

  # touch: bumps source_updated_at *and* updated_at on the project. The editor
  # saves content through nested attributes, which leaves the projects row itself
  # unchanged, so without this neither "last edited" nor build staleness has a
  # timestamp to trust.
  belongs_to :project, touch: :source_updated_at

  # Any content may carry attachments, served by Content::AttachedFiles; only
  # assets use them so far, and only one each: a file asset's upload, a generated
  # asset's preview picture (see Content::AssetBehavior).
  has_many_attached :files

  # The file/authored distinction an asset used to keep in a column of its own
  # is part of `kind` itself, so one enum says everything about what a record is.
  #
  # scopes: false because the generated scopes would be singular (`division`,
  # `file_asset`); the plural ones below read better at every call site and
  # include the one grouping the enum cannot express, `assets`.
  enum :kind, { division: 0, snippet: 1, file_asset: 2, authored_asset: 3 },
    scopes: false, validate: true

  ASSET_KINDS = %w[ file_asset authored_asset ].freeze

  scope :divisions, -> { where(kind: :division) }
  scope :snippets, -> { where(kind: :snippet) }
  scope :assets, -> { where(kind: ASSET_KINDS) }

  # The format of `source`, which decides how it is edited and how it reaches the
  # assembled document. Divisions and snippets are prose in one of three markup
  # styles. An asset's source is the inside of its <image>: PreTeXt, except that
  # an authored asset may instead be written in a generator's own language, which
  # makes it a generated asset (Content::GeneratedAssetBehavior::FORMATS). A key
  # added for a generator is the web-editor's id for it.
  enum :source_format, { pretext: 0, latex: 1, markdown: 2, prefigure: 3, tikz: 4 },
    default: :pretext, suffix: true, validate: true

  PROSE_FORMATS = %w[ pretext latex markdown ].freeze

  validates :ref, format: REF_REGEX, presence: true, uniqueness: { scope: :project_id }
  validates :source_format, inclusion: { in: PROSE_FORMATS }, if: -> { division? || snippet? }
  validates :source_format, inclusion: { in: %w[ pretext ] }, if: :file_asset?

  def asset?
    file_asset? || authored_asset?
  end
end
