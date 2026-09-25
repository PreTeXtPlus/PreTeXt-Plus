require "test_helper"

class CompactProjectDocsJobTest < ActiveJob::TestCase
  def fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  setup do
    @project = projects(:one)
    @key = ProjectDoc.key_for(@project)
    ProjectDoc.seed(@project, fixture("seed_state"))
  end

  def document
    Y::Document.find_by(key: @key)
  end

  def source
    doc = Y::Doc.new
    doc.apply_update(ProjectDoc.load_state(@key))
    JSON.parse(doc.read_map("divisions") || "{}").values.first["source"]
  end

  test "recording an update never compacts inline" do
    # The point of the job existing: folding a book-sized snapshot takes ~90ms,
    # and under yrby's own `append` that bill lands on whichever keystroke
    # happens to tip the tail past the threshold.
    CompactProjectDocsJob::TAIL_THRESHOLD.times do
      ProjectDoc.record(@key, fixture("one_update"))
    end

    assert_equal CompactProjectDocsJob::TAIL_THRESHOLD, document.updates.count,
      "ProjectDoc.record must only append"
  end

  test "a short tail is left alone" do
    ProjectDoc.record(@key, fixture("one_update"))

    CompactProjectDocsJob.perform_now

    assert_equal 1, document.updates.count
  end

  test "a long tail folds into the snapshot without changing the document" do
    before = source
    (CompactProjectDocsJob::TAIL_THRESHOLD + 1).times do
      ProjectDoc.record(@key, fixture("one_update"))
    end
    assert_operator document.updates.count, :>=, CompactProjectDocsJob::TAIL_THRESHOLD

    CompactProjectDocsJob.perform_now

    assert_equal 0, document.updates.count, "the tail folded into the snapshot"
    assert_not_equal before, source, "and the update's content is in the snapshot"
    assert_includes source, 'xmlns:plus="https://pretext.plus"'
  end

  test "one document that will not fold does not stop the others" do
    other = projects(:two)
    ProjectDoc.seed(other, fixture("seed_state"))
    (CompactProjectDocsJob::TAIL_THRESHOLD + 1).times do
      ProjectDoc.record(@key, fixture("one_update"))
      ProjectDoc.record(ProjectDoc.key_for(other), fixture("one_update"))
    end

    failing = document
    Y::Document.stub(:find_by, ->(id:) {
      found = Y::Document.unscoped.where(id: id).first
      found.define_singleton_method(:compact!) { raise "boom" } if found&.id == failing.id
      found
    }) do
      assert_nothing_raised { CompactProjectDocsJob.perform_now }
    end

    assert_equal 0, Y::Document.find_by(key: ProjectDoc.key_for(other)).updates.count,
      "the healthy document still compacted"
    assert_operator document.updates.count, :>, 0,
      "the failing document kept its tail, which is still correct to serve"
  end
end
