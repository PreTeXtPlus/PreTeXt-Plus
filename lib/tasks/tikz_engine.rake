# The TikZ engine is a download rather than a build product: the release pinned in
# config/tikz_engine.json, unpacked into public/engines by script/fetch-tikz-engine.js,
# which does nothing when that release is already there.
#
# Hooked onto assets:precompile for the reason assembler:build is: it is the one command
# every host already runs, so there is no deploy step to remember. Hatchbox builds each
# release in a fresh directory, so this downloads on every deploy.
#
# Unlike assembler:build, not on the test hooks. Nothing in the suite loads the engine,
# and a test run should not depend on the network.
namespace :tikz_engine do
  desc "Fetch the TikZ engine pinned in config/tikz_engine.json into public/engines"
  task :fetch do
    # `exception: true`, as for the assembler. A release without the engine looks healthy
    # and quietly stops rendering TikZ, whereas a failed deploy leaves the running release
    # alone and says why. The host clones from GitHub too, so an outage there stops the
    # deploy before this could.
    system "node script/fetch-tikz-engine.js", exception: true
  end
end

Rake::Task["assets:precompile"].enhance([ "tikz_engine:fetch" ]) if Rake::Task.task_defined?("assets:precompile")
