require "uri"
require "net/http"

# One place for "how do we reach the full build server" (pretext-plus-build-full): where
# it lives, the bearer token, and how to resolve the URLs it hands back.
#
# That last part is the reason this exists rather than each caller doing its own
# Net::HTTP. The server answers in paths relative to itself -- "/builds/<job>/artifact",
# "/builds/<job>/log" -- because it does not know which hostname it was reached on. Every
# caller therefore has to join them against the configured host, and a caller that
# forgets ends up pointing at pretext.plus instead.
module FullBuildServer
  # Generous enough for a log endpoint reading a value out of Redis, short enough that a
  # wedged build server cannot hold a queue slot (or a webhook response) open for minutes.
  TIMEOUTS = { open_timeout: 5, read_timeout: 15 }.freeze

  module_function

  def host
    Rails.application.credentials.dig(:full_build, :host)
  end

  def token
    Rails.application.credentials.dig(:full_build, :token)
  end

  # Absolute URL for something the server gave us. An already-absolute URL passes through
  # unchanged, so a caller does not have to know which of the two it was handed.
  def url_for(path)
    URI.join("https://#{host}", path.to_s).to_s
  end

  def get(path)
    request(Net::HTTP::Get, path)
  end

  def post(path)
    request(Net::HTTP::Post, path)
  end

  def request(request_class, path)
    uri = URI.parse(url_for(path))
    http_request = request_class.new(uri)
    http_request["Authorization"] = "Bearer #{token}"

    Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", **TIMEOUTS) do |http|
      http.request(http_request)
    end
  end
end
