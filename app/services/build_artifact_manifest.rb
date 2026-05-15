class BuildArtifactManifest
  REQUIRED_KEYS = %w[version build_id generated_at entrypoint files].freeze

  attr_reader :payload

  def initialize(payload)
    @payload = payload
  end

  def valid?
    errors.empty?
  end

  def errors
    @errors ||= begin
      list = []

      unless payload.is_a?(Hash)
        list << "manifest must be a hash"
        list
      else
        missing = REQUIRED_KEYS - payload.keys
        list << "missing keys: #{missing.join(', ')}" if missing.any?

        files = payload["files"]
        if !files.is_a?(Array) || files.empty?
          list << "files must be a non-empty array"
        elsif files.any? { |file| !file.is_a?(Hash) || file["path"].blank? || file["content_type"].blank? }
          list << "each file must include path and content_type"
        end

        entrypoint = payload["entrypoint"]
        if entrypoint.blank?
          list << "entrypoint must be present"
        elsif files.is_a?(Array) && files.none? { |file| file["path"] == entrypoint }
          list << "entrypoint must exist in files"
        end

        list
      end
    end
  end
end