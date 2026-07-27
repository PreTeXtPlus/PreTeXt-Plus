# One Yjs update (opaque binary) appended since the project doc's last
# compaction. The bigint primary key gives compaction its ordering: a client
# that merged everything through id N posts a fresh snapshot and the server
# deletes rows with id <= N, leaving any updates that raced in afterwards --
# CRDT merges are commutative, so snapshot + remaining rows stays correct.
class ProjectDocUpdate < ApplicationRecord
  belongs_to :project
end
