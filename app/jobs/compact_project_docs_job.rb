# frozen_string_literal: true

# Fold each collaborative document's update tail back into its snapshot.
#
# yrby compacts inline, inside the `on_change` that records an update, once the
# tail passes `Y::Document.compact_every`. That default suits a rich-text field;
# it does not suit a PreTeXt book, where the snapshot runs to most of a megabyte
# and folding it takes around 90ms -- paid, under the inline scheme, by whichever
# keystroke happens to be the one that tips the count, in the middle of somebody
# typing. ProjectDoc#record therefore only appends, and the fold happens here.
#
# Nothing is lost by waiting. A document is correct as snapshot-plus-tail at
# every moment; compaction only makes it cheaper to load. The cost of a longer
# tail is paid on join, where `load_state` applies the tail over the snapshot,
# which is why the threshold is low enough to keep that within a few
# milliseconds rather than left to grow all day.
class CompactProjectDocsJob < ApplicationJob
  queue_as :default

  # How long a tail may get before it is worth folding. Well under the ~64 rows
  # yrby would fold at, because the fold is off the hot path now and a short
  # tail keeps every join cheap.
  TAIL_THRESHOLD = 32

  # Rows yrby has quarantined as carrying a causal gap are excluded: they cannot
  # fold into the snapshot until the update they depend on arrives, and counting
  # them would make this job retry the same document every minute forever.
  def perform
    document_ids = Y::DocumentUpdate
      .where(pending: false)
      .group(:document_id)
      .having("COUNT(*) >= ?", TAIL_THRESHOLD)
      .pluck(:document_id)

    document_ids.each do |id|
      document = Y::Document.find_by(id: id)
      next if document.nil?

      document.compact!
    rescue StandardError => e
      # One document that will not fold must not stop the rest. It stays as
      # snapshot-plus-tail, which is still correct to serve.
      Honeybadger.notify(e, context: { y_document_id: id })
      Rails.logger.error("[collab] compaction failed for y_document #{id}: #{e.message}")
    end
  end
end
