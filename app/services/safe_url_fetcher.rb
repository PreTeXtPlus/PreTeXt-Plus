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

  def call
    body = +""
    content_type = nil

    SsrfFilter.get(@url, http_options: HTTP_OPTIONS) do |response|
      raise FetchError, "Request failed (#{response.code})" unless response.is_a?(Net::HTTPSuccess)

      content_type = response.content_type.to_s
      raise FetchError, "URL does not point to an image" unless content_type.start_with?("image/")

      response.read_body do |chunk|
        body << chunk
        raise FetchError, "Image too large" if body.bytesize > MAX_BYTES
      end
    end

    [ body, content_type ]
  rescue *UNSAFE_URL_ERRORS => e
    raise UnsafeUrlError, e.message
  rescue SocketError, SystemCallError, Net::OpenTimeout, Net::ReadTimeout, IOError, OpenSSL::SSL::SSLError => e
    raise FetchError, "Could not fetch URL: #{e.message}"
  end
end
