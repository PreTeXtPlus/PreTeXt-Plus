# frozen_string_literal: true

require "open3"

# Assemble a project's standalone PreTeXt document -- the `<pretext>` element,
# docinfo and body, with every `<plus:* ref="..."/>` placeholder resolved and
# every latex/markdown division converted -- by running the web-editor's own
# assembler under Node.
#
# This used to be `projects.pretext_source`, a column the browser wrote on a
# ten-second autosave. That arrangement had one writer too many: an idle
# collaborator's tab could overwrite source a build had just consumed, and the
# build read whatever happened to be in the row at the time. The column is gone.
# A build asks for the document instead, and gets one assembled from the rows as
# they are at that moment.
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
  # around, which is the whole point of dropping the column.
  class AssemblyError < StandardError; end

  # Built by `npm run build:assembler`, which assets:precompile runs on deploy
  # (lib/tasks/assembler.rake).
  BUNDLE = Rails.root.join("lib", "assembler", "assemble.mjs").freeze

  # The Node to run it under. Overridable because a deploy that installs Node
  # per-version (Hatchbox reads .node-version, as does mise/asdf locally) can
  # leave the binary off a background worker's PATH even though it is on the
  # deploying shell's.
  NODE = ENV.fetch("NODE_BINARY", "node").freeze

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
    raise AssemblyError, "assembler bundle missing at #{BUNDLE} (run `npm run build:assembler`)" unless BUNDLE.exist?

    out, err, status = run(JSON.generate(payload))
    raise AssemblyError, "assembler exited #{status.exitstatus}: #{err.strip.truncate(2000)}" unless status.success?

    out
  rescue Errno::ENOENT => e
    # No `node` on this process's PATH -- a deploy problem, not a document one,
    # and worth saying so rather than letting a bare ENOENT surface.
    raise AssemblyError, "could not run #{NODE}: #{e.message} (set NODE_BINARY if it is not on PATH)"
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
        is_root: division.is_root
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
      return json unless asset.file.attached?

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

    # Open3.capture3 would do all of this in one line but cannot be given a
    # deadline, and a wedged Node process holds the job's worker for as long as
    # it runs. So: threads to keep the pipes draining (a document larger than
    # the pipe buffer deadlocks otherwise), and a hard kill when the deadline
    # passes.
    def run(input)
      Open3.popen3(NODE, BUNDLE.to_s) do |stdin, stdout, stderr, wait|
        # EPIPE, from either the write or the close of a pipe whose reader has
        # already gone, means the child died before taking its input. Swallowed
        # because the exit status says what happened and says it better: raising
        # here would replace "assembler exited 1: <the real error>" with a broken
        # pipe.
        writer = Thread.new do
          stdin.write(input)
          stdin.close
        rescue Errno::EPIPE
          nil
        end
        out = Thread.new { stdout.read }
        err = Thread.new { stderr.read }

        unless wait.join(TIMEOUT)
          Process.kill("KILL", wait.pid)
          wait.join
          [ writer, out, err ].each(&:kill)
          raise AssemblyError, "assembler timed out after #{TIMEOUT}s"
        end

        writer.join
        [ out.value, err.value, wait.value ]
      end
    end
end
