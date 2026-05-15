class ProjectBuildState
  STATES = %w[pending queued running succeeded failed].freeze

  ALLOWED_TRANSITIONS = {
    "pending" => %w[queued],
    "queued" => %w[running failed],
    "running" => %w[succeeded failed],
    "succeeded" => %w[queued],
    "failed" => %w[queued]
  }.freeze

  def self.valid_state?(value)
    STATES.include?(value.to_s)
  end

  def self.allowed_transition?(from:, to:)
    return false unless valid_state?(from) && valid_state?(to)

    ALLOWED_TRANSITIONS.fetch(from.to_s, []).include?(to.to_s)
  end
end