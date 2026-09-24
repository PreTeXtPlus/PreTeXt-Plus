# The Node assembler SourceAssembler shells out to is a build product, the same
# way app/assets/builds is: bundled from script/assemble-source.mjs, ignored by
# git, and rebuilt from source on every deploy.
#
# Hooked onto assets:precompile rather than given its own deploy step because
# that is the one command every host already runs, and because the thing being
# bundled -- packages/web-editor -- is the same source the browser bundle is
# built from. If one is stale the other is too, so they should never be built
# apart.
namespace :assembler do
  desc "Bundle script/assemble-source.mjs into lib/assembler/assemble.mjs"
  task :build do
    # `exception: true` matters: without it a failed bundle is a silent no-op
    # that leaves the previous (or no) assembler in place, and the first thing
    # anyone hears about it is a build failing in production.
    system "npm run build:assembler", exception: true
  end
end

# The same set of hooks jsbundling-rails puts javascript:build on, and for the
# same reasons: precompile covers deploy, and the test hooks mean a suite run
# has a freshly bundled assembler rather than whatever was last built. Without
# those, SourceAssemblerTest skips its real-assembly cases and the Node path
# goes untested in CI.
#
# Each is guarded because a task only exists when whatever defines it is loaded.
[ "assets:precompile", "test:prepare", "db:test:prepare" ].each do |name|
  Rake::Task[name].enhance([ "assembler:build" ]) if Rake::Task.task_defined?(name)
end
