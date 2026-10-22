# frozen_string_literal: true

require "open3"

# Run one of the Node bundles in lib/assembler: hand it a string on stdin, take
# its stdout back. Shared by SourceAssembler and DivisionSourceSplitter, which
# both shell out to the web-editor's own code rather than keep a Ruby copy of
# it -- see SourceAssembler for why.
class NodeScript
  # Raised for anything that leaves us without output: no bundle, a non-zero
  # exit, a timeout, no `node` to run it under.
  class Error < StandardError; end

  # The Node to run it under. Overridable because a deploy that installs Node
  # per-version (Hatchbox reads .node-version, as does mise/asdf locally) can
  # leave the binary off a background worker's PATH even though it is on the
  # deploying shell's.
  NODE = ENV.fetch("NODE_BINARY", "node").freeze

  def initialize(bundle, timeout:)
    @bundle = bundle
    @timeout = timeout
  end

  # @return [String] the script's stdout
  # @raise [Error]
  def call(input)
    raise Error, "bundle missing at #{@bundle} (run `npm run build:assembler`)" unless @bundle.exist?

    out, err, status = run(input)
    raise Error, "#{@bundle.basename} exited #{status.exitstatus}: #{err.strip.truncate(2000)}" unless status.success?

    out
  rescue Errno::ENOENT => e
    # No `node` on this process's PATH -- a deploy problem, not an input one,
    # and worth saying so rather than letting a bare ENOENT surface.
    raise Error, "could not run #{NODE}: #{e.message} (set NODE_BINARY if it is not on PATH)"
  end

  private

    # Open3.capture3 would do all of this in one line but cannot be given a
    # deadline, and a wedged Node process holds the job's worker for as long as
    # it runs. So: threads to keep the pipes draining (an output larger than
    # the pipe buffer deadlocks otherwise), and a hard kill when the deadline
    # passes.
    def run(input)
      Open3.popen3(NODE, @bundle.to_s) do |stdin, stdout, stderr, wait|
        # EPIPE, from either the write or the close of a pipe whose reader has
        # already gone, means the child died before taking its input. Swallowed
        # because the exit status says what happened and says it better: raising
        # here would replace "exited 1: <the real error>" with a broken pipe.
        writer = Thread.new do
          stdin.write(input)
          stdin.close
        rescue Errno::EPIPE
          nil
        end
        out = Thread.new { stdout.read }
        err = Thread.new { stderr.read }

        unless wait.join(@timeout)
          Process.kill("KILL", wait.pid)
          wait.join
          [ writer, out, err ].each(&:kill)
          raise Error, "#{@bundle.basename} timed out after #{@timeout}s"
        end

        writer.join
        [ out.value, err.value, wait.value ]
      end
    end
end
