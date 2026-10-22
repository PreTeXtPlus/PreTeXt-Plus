# frozen_string_literal: true

# Assemble a project's standalone PreTeXt document -- the `<pretext>` element,
# docinfo and body, with every `<plus:* ref="..."/>` placeholder resolved and
# every latex/markdown division converted -- by running the web-editor's own
# assembler under Node.
#
# This used to be `projects.pretext_source`, a column the browser wrote on a
# ten-second autosave. That arrangement had one writer too many: an idle
# collaborator's tab could overwrite source a build had just consumed, and the
# build read whatever happened to be in the row at the time. Nothing reads or
# writes that column now (it stays only as a rollback path; see the migration
# that introduced `root_element`). A build asks for the document instead, and
# gets one assembled from the rows as they are at that moment.
#
# Why Node: the assembler is `assembleFullProjectSource`, ~3,400 lines of
# TypeScript over xast-util and the latex/markdown converters, with no Ruby
# equivalent. Rather than reimplement it -- and own two readings of what a
# document means -- the server runs the same code the browser does. See
# script/assemble-source.mjs for the process contract, and
# app/javascript/controllers/react/railsProjectMapping.js for the shared mapping
# that makes the two agree.
#
# Cost is a Node process: ~160ms of startup against ~2ms of assembly for a
# 133-division book. That is why this is called once per build rather than, say,
# per page render -- see Project#structural_document_type for the read path that
# deliberately does not use it.
class SourceAssembler
  # Raised for anything that leaves us without a document: no bundle, a
  # non-zero exit, a timeout. Never rescued here -- a build that cannot
  # assemble its source must fail loudly rather than ship whatever was lying
  # around, which is the whole point of no longer storing it.
  class AssemblyError < StandardError; end

  # Built by `npm run build:assembler`, which assets:precompile runs on deploy
  # (lib/tasks/assembler.rake).
  BUNDLE = Rails.root.join("lib", "assembler", "assemble.mjs").freeze

  # Generous against measured cost (~0.2s for a book) because the only thing
  # this protects against is a pathological document wedging the process: the
  # assembler is CPU-bound and makes no network calls, so a run that has taken
  # half a minute is not going to finish.
  TIMEOUT = 30

  def initialize(project)
    @project = project
  end

  # @return [String] the assembled document, or "" for a project with no root
  #   division -- which is what the editor's own save path produced for one, and
  #   what the column held.
  # @raise [AssemblyError]
  def call
    NodeScript.new(BUNDLE, timeout: TIMEOUT).call(JSON.generate(payload))
  rescue NodeScript::Error => e
    raise AssemblyError, "assembler: #{e.message}"
  end

  # The project as the assembler reads it: the same shape and the same values
  # `projects/_project.json.jbuilder` renders for the editor, narrowed to the
  # fields assembly actually consumes.
  #
  # Narrowed rather than rendered through the jbuilder because that template
  # wants a request -- `project_url`, `current_user` -- which a build job has
  # nothing to give it. The cost of the copy is that the two can drift, so
  # SourceAssemblerTest asserts this against the real rendered JSON rather than
  # against a fixture of it.
  #
  # `document_type` is the *structural* one, exactly as the jbuilder sends it:
  # it is what the assembler uses as the root element for a latex or markdown
  # root, which carries no PreTeXt tag of its own to read one from.
  def payload
    # Values go over exactly as the jbuilder sends them, nil included: turning a
    # null docinfo into "" here would be a second opinion about what a blank
    # field means, and railsToEditorState already has the first one.
    {
      title: @project.title,
      docinfo: @project.docinfo,
      common_docinfo: @project.common_docinfo,
      use_common_docinfo: @project.use_common_docinfo,
      document_type: @project.structural_document_type,
      language: @project.language,
      divisions: @project.divisions.map { |division| division_json(division) },
      assets: @project.assets.map { |asset| asset_json(asset) },
      snippets: @project.snippets.map { |snippet| snippet_json(snippet) }
    }
  end

  private

    def division_json(division)
      {
        id: division.id,
        ref: division.ref,
        source: division.source,
        source_format: division.source_format,
        is_root: division.is_root,
        title: division.title,
        division_type: division.division_type,
        label: division.label,
        attrs: division.attrs
      }
    end

    # `extension`/`content_type`/`path` are present only for an attached file,
    # matching the jbuilder: the web-editor reads their absence as "this asset
    # has no file", and an image with a `source` attribute naming a file the
    # archive never wrote is a build failure.
    def asset_json(asset)
      json = {
        id: asset.id,
        ref: asset.ref,
        kind: asset.kind,
        source: asset.source,
        short_description: asset.short_description,
        title: asset.title
      }
      return json unless asset.file_attached?

      extension = asset.file_extension
      json.merge(
        path: Rails.application.routes.url_helpers.share_asset_project_path(
          asset.project, ref: asset.ref, format: extension
        ),
        extension: extension,
        content_type: asset.file_content_type
      )
    end

    def snippet_json(snippet)
      {
        id: snippet.id,
        ref: snippet.ref,
        source: snippet.source,
        source_format: snippet.source_format
      }
    end
end
