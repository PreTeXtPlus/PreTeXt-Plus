require "ssrf_filter"

# Fetches an image from a user-supplied URL without persisting it anywhere.
# SSRF protection (resolving + validating the IP, pinning the connection to
# it so a later DNS change can't redirect the request, safely re-validating
# every redirect hop) is delegated to the ssrf_filter gem; this class only
# adds the image-specific checks on top: content-type and a size cap.
class SafeUrlFetcher
  class UnsafeUrlError < StandardError; end
  class FetchError < StandardError; end

  MAX_BYTES = 15.megabytes
  HTTP_OPTIONS = { open_timeout: 5, read_timeout: 10 }.freeze

  UNSAFE_URL_ERRORS = [
    SsrfFilter::InvalidUriScheme,
    SsrfFilter::PrivateIPAddress,
    SsrfFilter::UnresolvedHostname,
    SsrfFilter::TooManyRedirects,
    SsrfFilter::CRLFInjection,
    SsrfFilter::CredentialLeakage,
    URI::InvalidURIError
  ].freeze

  def self.call(url)
    new(url).call
  end

  def initialize(url)
    @url = url
  end

  # FetchError messages are shown to the author as they are, so the details behind
  # one (a status code, a socket error) go to the log rather than into the message.
  # An UnsafeUrlError keeps the ssrf_filter gem's own wording; AssetFetchesController
  # logs that and shows its own sentence.
  def call
    body = +""
    content_type = nil

    SsrfFilter.get(@url, http_options: HTTP_OPTIONS) do |response|
      unless response.is_a?(Net::HTTPSuccess)
        Rails.logger.info("[SafeUrlFetcher] #{@url} answered HTTP #{response.code}")
        raise FetchError, "We couldn't download that image."
      end

      content_type = response.content_type.to_s
      raise FetchError, "That address isn't an image." unless content_type.start_with?("image/")

      response.read_body do |chunk|
        body << chunk
        raise FetchError, "That image is too large (max #{MAX_BYTES / 1.megabyte} MB)." if body.bytesize > MAX_BYTES
      end
    end

    [ body, content_type ]
  rescue *UNSAFE_URL_ERRORS => e
    raise UnsafeUrlError, e.message
  rescue SocketError, SystemCallError, Net::OpenTimeout, Net::ReadTimeout, IOError, OpenSSL::SSL::SSLError => e
    Rails.logger.info("[SafeUrlFetcher] #{@url}: #{e.class}: #{e.message}")
    raise FetchError, "We couldn't reach that address."
  end
end
