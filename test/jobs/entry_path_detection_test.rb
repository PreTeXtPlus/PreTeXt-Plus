require "test_helper"

# Where a reader gets sent for a finished build. A site has an index; a pdf or braille
# build is one file whose name PreTeXt chose; a SCORM build is a package. Detection runs
# at import time in FullBuildArtifactJob, against the files that actually arrived, rather
# than guessing later -- and it consults the target's *kind*, which is the only thing
# that can tell a website from a SCORM package, since both are format="html".
class EntryPathDetectionTest < ActiveSupport::TestCase
  def detect(target, paths)
    build = target.builds.create!
    paths.each { |p| build.build_files.create!(relative_path: p) }
    FullBuildArtifactJob.new.send(:detect_entry_path, build)
  end

  test "an html site opens at its index" do
    target = targets(:one_web)
    assert_equal "index.html", detect(target, %w[ index.html chapter-1.html _static/style.css ])
  end

  # ProjectArchiveBuilder asks for this name via output-filename, so it should be found
  # verbatim rather than guessed at.
  test "a pdf opens at the filename the manifest asked for" do
    target = targets(:one_print)
    assert_equal "print.pdf", detect(target, %w[ print.pdf print.log ])
  end

  # braille takes no output-filename in PreTeXt's schema, so its name is only knowable
  # after the build.
  test "braille falls back to the extension the kind produces" do
    target = projects(:one).targets.create!(name: "brl", kind: "braille")
    assert_equal "book.brf", detect(target, %w[ book.brf build.log ])
  end

  test "a shallow artifact beats a deeper file of the same type" do
    target = targets(:one_print)
    assert_equal "print.pdf", detect(target, %w[ assets/figures/diagram.pdf print.pdf ])
  end

  test "an unrecognizable output still yields something openable" do
    target = projects(:one).targets.create!(name: "odd", kind: "braille")
    assert_equal "out.dat", detect(target, %w[ out.dat ])
  end

  test "a build with no files has no entry point" do
    target = targets(:one_print)
    assert_nil detect(target, [])
  end

  # Target#entry_path prefers what the build reported, and only falls back to what the
  # format implies when nothing has been built.
  test "Target#entry_path prefers the build's own answer" do
    target = targets(:one_print)
    assert_equal "print.pdf", target.entry_path, "unbuilt target should fall back to the manifest name"

    build = target.builds.create!
    build.build_files.create!(relative_path: "something-else.pdf")
    build.mark!(:success, entry_path: "something-else.pdf")

    assert_equal "something-else.pdf", target.reload.entry_path
  end

  # The case that keying detection on `format` alone got wrong: a SCORM package is
  # format="html", so an extension table keyed on the format would send the author to
  # some .html file inside the package instead of the package itself.
  test "a scorm package opens at the package, not at the html inside it" do
    target = projects(:one).targets.create!(name: "lms", kind: "scorm")

    assert_equal "lms.zip", detect(target, %w[ lms.zip index.html chapter-1.html ])
  end

  test "a zipped website behaves the same way" do
    target = projects(:one).targets.create!(name: "offline", kind: "website_zip")

    assert_equal "offline.zip", detect(target, %w[ offline.zip index.html ])
  end

  # Same document, same PreTeXt format, opposite answers -- which is the whole reason the
  # kind is what gets stored.
  test "a website and a scorm package disagree despite both being html" do
    scorm = projects(:one).targets.create!(name: "lms2", kind: "scorm")

    assert_equal "index.html", detect(targets(:one_web), %w[ index.html out.zip ])
    assert_equal "out.zip", detect(scorm, %w[ index.html out.zip ])
  end
end
