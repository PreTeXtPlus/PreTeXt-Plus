require "test_helper"

class TargetTest < ActiveSupport::TestCase
  test "belongs to a project and has many builds" do
    target = targets(:two_web)
    assert_equal projects(:two), target.project
    assert_includes target.builds, builds(:two)
    assert_includes target.builds, builds(:failed)
  end

  test "publishing on a private project escalates its visibility to unlisted" do
    target = targets(:two_web)
    assert target.project.private_visibility?

    target.update!(published: true)

    assert target.project.reload.unlisted_visibility?
  end

  test "publishing on an unlisted or public project leaves visibility untouched" do
    target = targets(:public_project_web)
    target.update!(published: false)
    target.project.update_column(:visibility, :unlisted)

    target.update!(published: true)

    assert target.project.reload.unlisted_visibility?
  end

  test "unpublishing never changes project visibility" do
    target = targets(:public_project_web)
    assert target.project.public_visibility?

    target.update!(published: false)

    assert target.project.reload.public_visibility?
  end

  test "name must be unique within a project but not across projects" do
    duplicate = Target.new(project: projects(:one), name: "Website", kind: "website")
    assert_not duplicate.valid?
    assert_equal [ "has already been taken" ], duplicate.errors[:name]

    other_project = Target.new(project: projects(:two), name: "Instructor edition", kind: "website")
    assert other_project.valid?
  end

  # Neither of these is a second output, and both used to slip past uniqueness.
  test "a name differing only by case or surrounding space is the same name" do
    assert_not Target.new(project: projects(:one), name: "  website ", kind: "website").valid?

    assert_equal "Print run", projects(:one).targets.create!(name: "  Print run  ", kind: "pdf").name
  end

  # An author who left the name blank made one mistake; the flash used to report it three
  # times, twice about a field the form does not have.
  test "a nameless target reports only the missing name" do
    target = Target.new(project: projects(:one), kind: "pdf")

    assert_not target.valid?
    assert_equal [ "Name can't be blank" ], target.errors.full_messages
  end

  # The decision that shapes the schema: the *slug* is the unique key, not `kind`,
  # matching how PreTeXt-CLI treats <targets> in project.ptx.
  test "two targets in one project may share a kind" do
    assert_equal "website", targets(:one_web).kind
    assert_equal "website", targets(:one_instructor).kind
    assert_equal projects(:one), targets(:one_instructor).project
  end

  # ---- naming ----

  # An author names an output the way they talk about it, and the manifest gets something
  # it can actually take. Nothing asks them to supply both.
  test "the slug is derived from the name" do
    target = projects(:one).targets.create!(name: "Instructor PDF", kind: "pdf")

    assert_equal "instructor-pdf", target.slug
    assert_equal "instructor-pdf.pdf", target.output_filename
  end

  test "a name is free text, unlike the slug it produces" do
    target = projects(:one).targets.create!(name: "Marta’s “big” print run!", kind: "pdf")

    assert target.valid?
    assert_match REF_REGEX, target.slug
  end

  # A PreTeXt target name has to start with a letter, so a name that parameterizes to
  # something illegal (or to nothing at all) falls back to the kind rather than to a
  # meaningless generated id.
  test "a name with nothing legal in it still yields a usable slug" do
    assert_equal "pdf-2nd-edition", projects(:one).targets.create!(name: "2nd edition", kind: "pdf").slug
    assert_equal "pdf", projects(:one).targets.create!(name: "★", kind: "pdf").slug
  end

  test "two names that slug alike get distinct slugs rather than an error" do
    first = projects(:one).targets.create!(name: "Print PDF", kind: "pdf")
    second = projects(:one).targets.create!(name: "Print (PDF)", kind: "pdf")

    assert_equal "print-pdf", first.slug
    assert_equal "print-pdf-2", second.slug
  end

  # The slug is in a link the author may already have handed out, and in `pretext build
  # <slug>` on a downloaded copy, so renaming on the dashboard must leave it alone.
  test "renaming a target does not move its slug" do
    target = targets(:one_print)

    target.update!(name: "Classroom handout")

    assert_equal "print", target.reload.slug
  end

  # ---- kind and the catalog ----

  test "kind must be one the catalog offers" do
    assert_not Target.new(project: projects(:one), name: "Nope", kind: "docx").valid?
    # Nor a PreTeXt format that is not itself an author-facing choice.
    assert_not Target.new(project: projects(:one), name: "Nope", kind: "custom").valid?
  end

  # The pair the whole re-modelling exists for. An author picks one thing; PreTeXt needs
  # two attributes; neither vocabulary leaks into the other.
  test "a scorm package emits html plus compression without being an html target" do
    target = projects(:one).targets.create!(name: "LMS package", kind: "scorm")

    assert_equal({ "format" => "html", "compression" => "scorm" }, target.manifest_attributes)
    # Not a site: it is a package you hand to an LMS, not something a reader browses.
    assert_not target.site?
    assert_includes target.output_extensions, ".zip"
  end

  test "a website is a site and a zipped website is not, though both emit html" do
    site = targets(:one_web)
    zipped = projects(:one).targets.create!(name: "Offline copy", kind: "website_zip")

    assert site.site?
    assert_not zipped.site?
    assert_equal "html", site.manifest_attributes["format"]
    assert_equal "html", zipped.manifest_attributes["format"]
  end

  # There is no way to spell an illegal combination, so there is nothing to validate:
  # compression exists only inside the kinds that legitimately carry it.
  test "no kind emits compression on a format that cannot carry it" do
    Target::Catalog.all.each do |kind|
      next if kind.emits["compression"].nil?

      assert_equal "html", kind.emits["format"],
        "#{kind.slug} emits compression on #{kind.emits['format']}, which project.ptx rejects"
    end
  end

  # Drives whether a row offers "Open" at all. A container you feed to something else has
  # nothing worth opening, and an "Open" button on it is a download in disguise.
  test "only outputs worth opening in a browser are viewable" do
    viewable = Target::Catalog.all.select(&:viewable).map(&:slug)

    assert_equal %w[ website pdf revealjs beamer ], viewable
    assert_not_includes viewable, "scorm"
    assert_not_includes viewable, "epub"
    assert_not_includes viewable, "website_zip"
  end

  test "every site is viewable without having to say so" do
    Target::Catalog.all.each do |kind|
      assert kind.viewable, "#{kind.slug} is a site but not viewable" if kind.site
    end
  end

  test "options are merged into the manifest attributes and win over the kind" do
    target = projects(:one).targets.create!(
      name: "Tuned", kind: "pdf", options: { "stringparam" => "debug.datedfiles yes" }
    )

    assert_equal "debug.datedfiles yes", target.manifest_attributes["stringparam"]
    assert_equal "pdf", target.manifest_attributes["format"]
  end

  test "output_filename is set only where the schema allows @output-filename" do
    assert_equal "print.pdf", targets(:one_print).output_filename
    # A website is a directory, so there is nothing to name.
    assert_nil targets(:one_web).output_filename
    # Beamer produces a PDF but is left to discovery -- see Target::Catalog.
    assert_nil projects(:slides).targets.create!(name: "Handout", kind: "beamer").output_filename
  end

  # ---- kind against the project's document type ----

  test "slides are rejected on a project that is not a slideshow" do
    target = Target.new(project: projects(:one), name: "Deck", kind: "revealjs")

    assert_not target.valid?
    assert_match(/slideshow/, target.errors[:kind].to_sentence)
  end

  test "slides are accepted on a slideshow" do
    assert Target.new(project: projects(:slides), name: "Second deck", kind: "revealjs").valid?
    assert Target.new(project: projects(:slides), name: "Handout", kind: "beamer").valid?
  end

  test "an unrestricted kind is available to every document type" do
    assert Target.new(project: projects(:slides), name: "Notes", kind: "pdf").valid?
    assert Target.new(project: projects(:one), name: "Notes", kind: "pdf").valid?
  end

  test "the picker offers slides only to a slideshow" do
    slugs = Target::Catalog.for_document_type(:article).map(&:slug)
    assert_includes slugs, "website"
    assert_includes slugs, "scorm"
    assert_not_includes slugs, "revealjs"
    assert_not_includes slugs, "beamer"

    assert_includes Target::Catalog.for_document_type(:slideshow).map(&:slug), "revealjs"
  end

  test "latest_build is the newest by created_at, not the newest successful" do
    assert_equal builds(:failed), targets(:two_web).latest_build
  end

  # ---- state ----

  test "state is never when the target has no successful build" do
    assert_equal :never, targets(:one_print).state
  end

  test "state is building whenever any build is in flight" do
    assert_equal :building, targets(:one_web).state
  end

  test "in-flight covers every status the build server might still answer for" do
    target = targets(:one_print)
    Target::IN_FLIGHT.each do |status|
      build = target.builds.create!(status: status)
      assert_equal :building, target.reload.state, "expected #{status} to read as building"
      build.destroy!
    end
  end

  test "both build pointers stay in step with the builds themselves" do
    target = targets(:one_print)
    assert_nil target.latest_build_id
    assert_nil target.current_build_id

    ok = target.builds.create!(created_at: 2.days.ago)
    ok.mark!(:success)
    target.reload
    assert_equal ok, target.latest_build
    assert_equal ok, target.current_build

    # A later failure moves latest_build but must leave current_build alone.
    bad = target.builds.create!(created_at: 1.day.ago)
    bad.mark!(:failed)
    target.reload
    assert_equal bad, target.latest_build
    assert_equal ok, target.current_build
  end

  test "state is failed when the last attempt failed, even though output is still live" do
    target = targets(:two_web)
    assert_equal :failed, target.state
    # The whole point: readers keep seeing the last good build.
    assert_equal builds(:two), target.current_build
  end

  # Canceled is terminal like failed, and reported separately from it: nothing went
  # wrong with the source, so a row saying Failed would send the author hunting through
  # a log for an error that is not there.
  test "state is canceled when the last attempt was canceled, and readers keep the live build" do
    target = targets(:two_web)
    builds(:failed).mark!(:canceled)

    assert_equal :canceled, target.reload.state
    assert_equal builds(:two), target.current_build
    assert_not target.building?
  end

  test "a canceled build is no longer in flight" do
    build = builds(:in_progress)
    assert build.in_flight?

    build.mark!(:canceled)

    assert_not build.reload.in_flight?
  end

  test "state is current when the successful build is newer than the last source edit" do
    target = targets(:one_print)
    projects(:one).update_column(:source_updated_at, 2.days.ago)
    build = target.builds.create!(created_at: 1.hour.ago)
    build.mark!(:success)

    assert_equal :current, target.reload.state
    assert_not target.stale?
  end

  test "state is stale when the source changed after the successful build" do
    target = targets(:one_print)
    build = target.builds.create!(created_at: 2.days.ago)
    build.mark!(:success)
    projects(:one).update_column(:source_updated_at, 1.hour.ago)

    assert_equal :stale, target.reload.state
    assert target.stale?
  end

  # ---- current_build bookkeeping ----

  test "only a successful build becomes the current one" do
    target = targets(:one_print)
    assert_nil target.current_build_id

    failed = target.builds.create!
    failed.mark!(:failed)
    assert_nil target.reload.current_build_id

    ok = target.builds.create!
    ok.mark!(:success)
    assert_equal ok, target.reload.current_build
    assert_equal ok.created_at, target.last_built_at
  end

  test "destroying the current build falls back to the previous successful one" do
    target = targets(:one_print)
    older = target.builds.create!(created_at: 2.days.ago)
    older.mark!(:success)
    newer = target.builds.create!(created_at: 1.day.ago)
    newer.mark!(:success)
    assert_equal newer, target.reload.current_build

    newer.destroy!
    assert_equal older, target.reload.current_build
  end

  test "destroying the only successful build clears the pointer" do
    target = targets(:two_web)
    assert_equal builds(:two), target.current_build

    builds(:two).destroy!

    assert_nil target.reload.current_build_id
    assert_nil target.last_built_at
  end

  # ---- retention ----

  test "pruning keeps only the retention window of successes" do
    target = targets(:one_print)
    oldest = target.builds.create!(created_at: 4.days.ago, status: :success)
    middle = target.builds.create!(created_at: 3.days.ago, status: :success)
    newest = target.builds.create!(created_at: 2.days.ago, status: :success)
    target.sync_from_builds!

    target.prune_builds!

    assert_empty Build.where(id: oldest.id)
    assert_equal [ newest, middle ], target.builds.where(status: :success).to_a
    # The pointers survive the cull intact.
    assert_equal newest, target.reload.current_build
  end

  test "pruning keeps a failure newer than the current success, and drops older ones" do
    target = targets(:one_print)
    old_failure = target.builds.create!(created_at: 4.days.ago, status: :failed)
    success = target.builds.create!(created_at: 2.days.ago, status: :success)
    new_failure = target.builds.create!(created_at: 1.day.ago, status: :failed)
    target.sync_from_builds!

    target.prune_builds!

    # The newest attempt is what `state` and the drawer's log report, so it stays.
    assert_empty Build.where(id: old_failure.id)
    assert Build.exists?(new_failure.id)
    assert_equal success, target.reload.current_build
    assert_equal new_failure, target.latest_build
  end

  test "pruning never removes an in-flight build" do
    target = targets(:one_print)
    in_flight = target.builds.create!(created_at: 4.days.ago, status: :in_progress)
    3.times { |i| target.builds.create!(created_at: (3 - i).days.ago, status: :success) }
    target.sync_from_builds!

    target.prune_builds!

    # Older than every kept success, but the build server still owes its callback an
    # answer, so the row has to be there to receive it.
    assert Build.exists?(in_flight.id)
  end

  test "previous_successful_build is the fallback, not the current build" do
    target = targets(:one_print)
    assert_nil target.previous_successful_build

    older = target.builds.create!(created_at: 2.days.ago, status: :success)
    assert_nil target.previous_successful_build

    target.builds.create!(created_at: 1.day.ago, status: :success)
    assert_equal older, target.previous_successful_build
  end

  test "destroying a target destroys its builds" do
    target = targets(:two_web)
    build_ids = target.builds.pluck(:id)
    assert build_ids.any?

    target.destroy!

    assert_empty Build.where(id: build_ids)
  end
end
