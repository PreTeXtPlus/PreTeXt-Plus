require "test_helper"

# Where a reader gets sent for a finished build. An html site has an index; a pdf or
# braille build is one file whose name PreTeXt chose. Detection runs at import time in
# FullBuildArtifactJob, against the files that actually arrived, rather than guessing
# later from the format.
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
  test "braille falls back to the extension the format produces" do
    target = projects(:one).targets.create!(name: "brl", output_format: :braille)
    assert_equal "book.brf", detect(target, %w[ book.brf build.log ])
  end

  test "a shallow artifact beats a deeper file of the same type" do
    target = targets(:one_print)
    assert_equal "print.pdf", detect(target, %w[ assets/figures/diagram.pdf print.pdf ])
  end

  test "an unrecognizable output still yields something openable" do
    target = projects(:one).targets.create!(name: "odd", output_format: :braille)
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

  test "a compressed html target is a file, not a site" do
    target = projects(:one).targets.create!(name: "lms", output_format: :html, compression: "scorm")

    assert_not target.site?
    assert targets(:one_web).site?
  end

  test "compression is rejected on formats that cannot carry it" do
    target = Target.new(project: projects(:one), name: "nope", output_format: :pdf, compression: "scorm")

    assert_not target.valid?
    assert_includes target.errors[:compression], "is only available for html targets"
  end
end
