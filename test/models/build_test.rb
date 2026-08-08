require "test_helper"

class BuildTest < ActiveSupport::TestCase
  include ActionCable::TestHelper
  include ActiveJob::TestHelper

  test "belongs to project" do
    assert_equal projects(:one), builds(:one).project
  end

  test "belongs to target" do
    assert_equal targets(:one_web), builds(:one).target
  end

  test "project is inherited from the target when not given" do
    build = Build.create!(target: targets(:one_instructor))
    assert_equal projects(:one), build.project
  end

  test "default status is pending" do
    build = Build.new(target: targets(:one_web))
    assert build.pending?
  end

  test "all status values round-trip" do
    assert builds(:one).pending?
    assert builds(:in_progress).in_progress?
    assert builds(:two).success?
    assert builds(:failed).failed?
    assert Build.new(target: targets(:one_web), status: :queued).queued?
  end

  test "status transitions via bang methods" do
    build = builds(:one)
    build.in_progress!
    assert build.in_progress?
    build.success!
    assert build.success?
    build.failed!
    assert build.failed?
  end

  test "invalid status is rejected" do
    build = Build.new(target: targets(:one_web), status: 99)
    assert_not build.valid?
  end

  # ---- mark! ----
  #
  # The single funnel for status transitions. Every job and controller goes through it so
  # that promoting a finished build (and, from PR 2, broadcasting the row) cannot be
  # forgotten at a new transition site.

  test "mark! sets the status and any extra columns" do
    build = builds(:one)
    build.mark!(:failed, log: "boom")

    assert build.reload.failed?
    assert_equal "boom", build.log
  end

  # click colours the CLI's level labels, so a raw log reads "\e[33mwarning: \e[0m..." and
  # the drawer's <pre> would print the codes as literal "[33m" in front of the warning.
  test "mark! strips the CLI's ANSI colour codes out of the log" do
    build = builds(:one)
    build.mark!(:failed, log: "\e[33mwarning: \e[0mno source\n\e[1;31merror: \e[0mboom")

    assert_equal "warning: no source\nerror: boom", build.reload.log
  end

  test "mark! rejects a status that is not in the enum" do
    assert_raises(KeyError) { builds(:one).mark!(:exploded) }
  end

  test "mark!(:success) promotes the build on its target" do
    build = builds(:one)
    assert_nil build.target.current_build_id

    build.mark!(:success)

    assert_equal build, build.target.reload.current_build
    assert_equal build.created_at, build.target.last_built_at
  end

  test "mark!(:failed) leaves an already-published output in place" do
    target = targets(:two_web)
    assert_equal builds(:two), target.current_build

    target.builds.create!.mark!(:failed)

    assert_equal builds(:two), target.reload.current_build
  end

  # The row used to be the only thing a finished build redrew, so an author who had the
  # drawer open watched it sit on "Building" -- with no log and a Cancel button -- until
  # they closed and reopened it.
  test "mark! tells an open drawer to reload as well as redrawing the row" do
    build = builds(:one)
    stream = Turbo::StreamsChannel.send(:stream_name_from, [ build.project, :targets ])

    broadcasts = capture_broadcasts(stream) do
      perform_enqueued_jobs { build.mark!(:success) }
    end

    assert_equal 2, broadcasts.size
    drawer, row = broadcasts.partition { |b| b.include?("reload_drawer") }

    assert_equal 1, row.size
    assert_equal 1, drawer.size

    # Aimed at the panel's own id, not the "drawer" frame: every dashboard watching this
    # project carries that frame, and only some of them have this target open.
    assert_match(/target="#{ActionView::RecordIdentifier.dom_id(build.target, :drawer)}"/, drawer.first)
    # A signal, not a payload -- the template rides along empty.
    assert_match(%r{<template></template>}, drawer.first)
  end

  # Why the drawer refresh is a signal at all. Its content is unbounded -- FullBuildLogJob
  # swaps the 4000-char log tail for the entire server-side log the moment a build
  # finishes, and the history table adds up to Target::HISTORY_LIMIT rows -- and an
  # earlier version of this broadcast sent that HTML. Development's cable.yml uses
  # Postgres LISTEN/NOTIFY, which rejects any payload past ~8000 bytes inside the
  # background job with nothing surfaced to the browser, so the drawer simply looked
  # frozen there while working in production's solid_cable.
  test "the drawer refresh broadcast is a signal, not the drawer's HTML" do
    target = targets(:one_web)
    target.builds.first.update_columns(log: "x" * 500_000)
    21.times { |i| target.builds.create!(project: target.project, status: :success, created_at: i.hours.ago) }

    stream = Turbo::StreamsChannel.send(:stream_name_from, [ target.project, :targets ])
    broadcasts = capture_broadcasts(stream) { target.broadcast_drawer }

    assert broadcasts.first.bytesize < 1000,
      "drawer broadcast was #{broadcasts.first.bytesize} bytes -- it should carry no HTML at all"
  end

  # ---- promotion ----
  #
  # Advancing the queue is not a separate mechanism -- it happens inside mark!, the one
  # place every status transition already passes through, so no transition site can
  # forget to check whether a slot just opened up. Fixtures leave user one with two
  # builds already in flight on one_web (pending + in_progress), one slot short of
  # Build::MAX_CONCURRENT.

  test "mark!(:success) promotes the oldest queued build for the same user" do
    queued = targets(:one_print).builds.create!(status: :queued, created_at: 10.minutes.ago)

    assert_enqueued_with(job: FullBuildJob, args: [ queued ]) do
      builds(:one).mark!(:success)
    end

    assert queued.reload.pending?
  end

  # The cap is per-user across every project they own, not per-project -- promotion has
  # to search the same way, or a queued build on a quieter project would starve forever
  # behind a busy one.
  test "promotion looks across every project the user owns, not just the one that just finished" do
    queued = targets(:slides_deck).builds.create!(status: :queued, created_at: 5.minutes.ago)

    assert_enqueued_with(job: FullBuildJob, args: [ queued ]) do
      builds(:one).mark!(:success)
    end

    assert queued.reload.pending?
  end

  test "promotion picks the oldest queued build first" do
    older = targets(:one_print).builds.create!(status: :queued, created_at: 20.minutes.ago)
    newer = targets(:one_instructor).builds.create!(status: :queued, created_at: 5.minutes.ago)

    assert_enqueued_with(job: FullBuildJob, args: [ older ]) do
      builds(:one).mark!(:success)
    end

    assert older.reload.pending?
    assert newer.reload.queued?
  end

  test "promotion does not fire when the transition stays in flight" do
    queued = targets(:one_print).builds.create!(status: :queued, created_at: 10.minutes.ago)

    builds(:one).mark!(:in_progress)

    assert queued.reload.queued?
  end

  test "promotion does nothing when no build is queued" do
    assert_no_enqueued_jobs(only: FullBuildJob) do
      builds(:one).mark!(:success)
    end
  end

  # Fixtures leave one slot open, so cancelling a build that was never occupying one
  # can still trigger a promotion -- it's the cap being checked fresh, not the
  # cancellation itself, that decides.
  test "cancelling a queued build can promote another queued build if a slot is actually free" do
    first_in_queue = targets(:one_print).builds.create!(status: :queued, created_at: 10.minutes.ago)
    second_in_queue = targets(:one_instructor).builds.create!(status: :queued, created_at: 5.minutes.ago)

    first_in_queue.mark!(:canceled)

    assert second_in_queue.reload.pending?
  end

  test "cancelling a queued build does not promote another when no slot is free" do
    targets(:one_print).builds.create!(status: :pending) # fills the cap: 3 now in flight
    first_in_queue = targets(:one_instructor).builds.create!(status: :queued, created_at: 10.minutes.ago)
    second_in_queue = targets(:slides_deck).builds.create!(status: :queued, created_at: 5.minutes.ago)

    first_in_queue.mark!(:canceled)

    assert second_in_queue.reload.queued?
  end

  test "has many build_files" do
    build = builds(:one)
    assert_includes build.build_files, build_files(:index)
    assert_includes build.build_files, build_files(:chapter)
  end

  test "destroying a build destroys its build_files" do
    build = builds(:one)
    file_ids = build.build_files.pluck(:id)
    assert file_ids.any?
    build.destroy!
    assert_empty BuildFile.where(id: file_ids)
  end
end
