require "net/http"
require "uri"
require "json"

class BuildServerClient
  def initialize(host: ENV["BUILD_HOST"], token: ENV["BUILD_TOKEN"])
    @host = host
    @token = token
  end

  def build_html(source:, title:)
    params = {
      source: source,
      title: title,
      token: @token
    }

    Net::HTTP.post_form(base_uri, params)
  end

  def build_artifacts(source:, title:)
    response = build_html(source: source, title: title)
    body = response.body.to_s
    content_type = response_content_type(response)

    if content_type&.include?("application/json")
      parse_json_artifacts(body)
    else
      html_fallback_artifacts(body)
    end
  rescue JSON::ParserError
    html_fallback_artifacts(body)
  end

  def preview_html(source:, title:, open_timeout: 5, read_timeout: 15)
    uri = base_uri
    post_params = {
      source: source,
      title: title,
      token: @token
    }

    Net::HTTP.start(
      uri.host,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: open_timeout,
      read_timeout: read_timeout
    ) do |http|
      request = Net::HTTP::Post.new(uri.request_uri)
      request["Content-Type"] = "application/x-www-form-urlencoded"
      request.body = URI.encode_www_form(post_params)
      http.request(request)
    end
  end

  private

  def base_uri
    host_str = @host.to_s
    uri_str = if host_str.match?(/^https?:\/\//)
      host_str
    else
      "https://#{host_str}"
    end
    URI.parse(uri_str)
  end

  def response_content_type(response)
    return unless response.respond_to?(:to_hash)

    values = response.to_hash["content-type"]
    values&.first
  end

  def html_fallback_artifacts(html)
    build_id = "legacy-#{SecureRandom.hex(8)}"
    manifest = {
      "version" => 1,
      "build_id" => build_id,
      "generated_at" => Time.current.iso8601,
      "entrypoint" => "index.html",
      "files" => [
        { "path" => "index.html", "content_type" => "text/html" }
      ]
    }

    {
      html: html,
      manifest: manifest,
      files: {
        "index.html" => {
          content: html,
          content_type: "text/html"
        }
      }
    }
  end

  def parse_json_artifacts(body)
    payload = JSON.parse(body)
    manifest = (payload["manifest"] || {}).dup
    files = {}

    artifacts = payload["artifacts"]
    if artifacts.is_a?(Array)
      artifacts.each do |artifact|
        path = artifact["path"].to_s
        next if path.blank?

        files[path] = {
          content: artifact["content"].to_s,
          content_type: artifact["content_type"].presence || "application/octet-stream"
        }
      end
    end

    inline_files = manifest["inline_files"]
    if inline_files.is_a?(Hash)
      manifest.fetch("files", []).each do |file|
        path = file["path"].to_s
        next if path.blank? || !inline_files.key?(path)

        files[path] = {
          content: inline_files[path].to_s,
          content_type: file["content_type"].presence || "application/octet-stream"
        }
      end
    end

    entrypoint = manifest["entrypoint"].to_s
    html = if entrypoint.present? && files[entrypoint]
      files[entrypoint][:content]
    else
      payload["html"].to_s
    end

    entrypoint = "index.html" if entrypoint.blank?
    if files[entrypoint].blank? && html.present?
      files[entrypoint] = {
        content: html,
        content_type: "text/html"
      }
    end

    manifest["version"] ||= 1
    manifest["build_id"] ||= "legacy-#{SecureRandom.hex(8)}"
    manifest["generated_at"] ||= Time.current.iso8601
    manifest["entrypoint"] = entrypoint
    manifest["files"] = files.map do |path, file_data|
      {
        "path" => path,
        "content_type" => file_data[:content_type]
      }
    end

    {
      html: html,
      manifest: manifest,
      files: files
    }
  end
end