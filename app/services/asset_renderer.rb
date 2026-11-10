require "json"
require "net/http"

# Renders one generated asset on the full build server, for the editor's preview of
# a generator no browser runs (Asymptote, Sage -- Content::GeneratedAssetBehavior::
# SERVER_RENDERED_FORMATS). Two halves, because the server is asynchronous and this
# app does not hold a request open while a container starts: `submit` ships a
# one-figure archive to `/generate` and hands back the job's status URL; `poll`
# reads that URL and, once the job is done, fetches the one file it made and turns
# it into the SVG the editor stores as the asset's preview.
#
# The job is sent with the project's id, so the file it makes also lands in the
# project's persistent cache on the build server, under the key a full build will
# look for (see GenerateArchiveBuilder). A preview is thus the build's own render,
# made early, not a second copy of the work.
module AssetRenderer
  class Error < StandardError; end

  # What a poll found. `status` is "pending", "success" or "failed"; `message` is the
  # server's own word while pending ("queued", "started"), or what went wrong; `log`
  # the CLI's transcript on a failure, when there is one.
  Result = Struct.new(:status, :svg, :message, :log, keyword_init: true)

  # The file a web render of each generator leaves in the cache, by element. A
  # sageplot is an SVG; an asymptote is an HTML page -- for a 2D figure, one whose
  # body is a single inline <svg> (what pretext-html reads the aspect ratio off), for
  # a 3D one, a WebGL canvas, which is not a picture this app can show yet.
  PICTURE_EXTENSION = { "asymptote" => "html", "sageplot" => "svg" }.freeze

  SVG_NAMESPACE = "http://www.w3.org/2000/svg".freeze

  THREE_D = "3D figures can't be previewed in the editor yet. Build the output to see it.".freeze
  NO_PICTURE = "This code didn't make an image. Check it for mistakes.".freeze
  FAILED = "We couldn't make this image. Check its code for mistakes.".freeze

  module_function

  # @param asset [Content] the generated asset, with the source to render on it (it
  #   need not be saved: the editor sends the source as typed).
  # @return [String] the job's status path on the build server.
  # @raise [Error, SourceAssembler::AssemblyError]
  def submit(project, asset)
    archive = GenerateArchiveBuilder.new(project, asset).build
    response = reaching("submit the render") do
      FullBuildServer.post_form("/generate", [
        [ "archive", archive, { filename: "project.zip", content_type: "application/zip" } ],
        [ "target", GenerateArchiveBuilder::TARGET ],
        [ "assets", asset.generated_element ],
        [ "project_id", project.id ]
      ])
    end
    unless response.is_a?(Net::HTTPSuccess)
      raise Error, "The build server refused the render (HTTP #{response.code}): #{response.body.to_s.truncate(300)}"
    end

    data = JSON.parse(response.body)
    data["status_url"].presence || raise(Error, "The build server gave no status URL for the render")
  end

  # @param status_url [String] from `submit`
  # @param element [String] the asset's generated_element, which names the cache
  #   directory the picture is in and the file it is.
  # @raise [Error] when the build server cannot be read at all.
  def poll(status_url, element)
    data = fetch_json(status_url)
    case data["status"]
    when "success" then picture(status_url, element, data)
    when "failed", "cancelled"
      Result.new(status: "failed", message: FAILED, log: log_of(data))
    else
      Result.new(status: "pending", message: data["status"].to_s)
    end
  end

  def picture(status_url, element, data)
    extension = PICTURE_EXTENSION.fetch(element)
    files = Array(data["files"]).grep(%r{\A#{Regexp.escape(element)}/})
    path = files.find { |file| file.end_with?(".#{extension}") }
    if path.nil?
      # A 3D sageplot makes an HTML page where a 2D one makes an SVG.
      message = files.any? { |file| file.end_with?(".html") } ? THREE_D : NO_PICTURE
      return Result.new(status: "failed", message: message, log: log_of(data))
    end

    body = utf8(fetch("#{status_url}/files/#{path}").body)
    svg = extension == "html" ? svg_from_page(body) : body
    return Result.new(status: "success", svg: svg) if svg

    Result.new(status: "failed", message: THREE_D)
  end

  # The inline <svg> of an Asymptote HTML page, or nil for a page without one (a 3D
  # figure's WebGL canvas). HTML5, not HTML4: the older parser lowercases attribute
  # names, and `viewBox` is not `viewbox`. Serialized as HTML too, since Nokogiri's
  # XML serializer prefixes every element of a parsed page's SVG; the HTML5
  # serializer writes foreign content as the XML it is, which the strict reparse
  # confirms before anything stores it as an SVG file.
  def svg_from_page(html)
    page = Nokogiri::HTML5(html)
    svg = page.at_css("body > svg") || page.at_css("svg")
    return nil unless svg

    # The parser already put the element in the SVG namespace; only the serialized
    # attribute may be missing, and an <img> reading the file needs it.
    markup = svg.to_html.sub(/\A<svg(?![^>]*\sxmlns=)/, %(<svg xmlns="#{SVG_NAMESPACE}"))
    Nokogiri::XML(markup, &:strict)
    markup
  rescue Nokogiri::XML::SyntaxError
    nil
  end

  def log_of(data)
    log = data["log"].presence
    return log if log || data["log_url"].blank?

    response = reaching("read the log") { FullBuildServer.get(data["log_url"]) }
    response.is_a?(Net::HTTPSuccess) ? utf8(response.body).presence : nil
  end

  # What going wrong on the wire looks like, as opposed to an answer we did not
  # like: a connection refused or timing out, a name that does not resolve, TLS.
  NETWORK_ERRORS = [ SystemCallError, SocketError, Net::OpenTimeout, Net::ReadTimeout, OpenSSL::SSL::SSLError ].freeze

  # Run `block`, a call to the build server, turning a failure to reach it into an
  # Error that names what was being attempted -- so the editor shows "the build
  # server could not be reached" rather than a bare 500.
  def reaching(attempt)
    yield
  rescue *NETWORK_ERRORS => e
    raise Error, "The build server could not be reached to #{attempt}: #{e.class.name.demodulize} (#{e.message})"
  end

  def fetch_json(path)
    JSON.parse(utf8(fetch(path).body))
  rescue JSON::ParserError
    raise Error, "The build server answered with something other than JSON"
  end

  # Net::HTTP hands a body back as binary (ASCII-8BIT) unless the response named
  # a charset, and the build server's files do not. A Sage plot's SVG has UTF-8
  # text in it (matplotlib's minus sign, for one), and the picture goes out again
  # as JSON, which cannot encode binary: the first real render failed exactly
  # there. Read as UTF-8, with any byte that is not valid UTF-8 replaced.
  def utf8(body)
    body.to_s.dup.force_encoding(Encoding::UTF_8).scrub
  end

  def fetch(path)
    response = reaching("read #{path}") { FullBuildServer.get(path) }
    unless response.is_a?(Net::HTTPSuccess)
      raise Error, "The build server returned HTTP #{response.code} for #{path}"
    end
    response
  end
end
