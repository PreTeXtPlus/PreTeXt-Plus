# The persisted Yjs document for a project's collaborative editing session.
# Rails treats the contents as opaque binary: clients do all CRDT work; the
# server only stores the latest compacted snapshot (here) plus an append-only
# log of updates since (ProjectDocUpdate) and relays live updates over
# ProjectDocChannel.
class ProjectDoc < ApplicationRecord
  belongs_to :project
end
