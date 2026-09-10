# Send one file straight to the lite build server's /pandoc/ endpoint, using
# this app's credentials but none of its request cycle:
#
#   bin/rails runner script/pandoc_check.rb path/to/your.docx
#
# It exists to split "the import wizard times out" into its three possible
# causes. If this succeeds, the build server and the credentials are fine and
# the fault is on this side -- compare against the `[pandoc]` line
# ProjectsController#pandoc logs for the same file. If this hangs or fails, the
# browser was never the problem.
#
# The read timeout is deliberately far longer than the controller's, so a merely
# slow answer (a cold build server, say) shows up as a slow success rather than
# as the timeout the wizard reports.
require "net/http"
require "uri"

path = ARGV.first or abort "usage: bin/rails runner pandoc_direct.rb FILE"
abort "no such file: #{path}" unless File.file?(path)

host = Rails.application.credentials.dig(:preview_build, :host)
token = Rails.application.credentials.dig(:preview_build, :token)
abort "no preview_build host in credentials" if host.blank?
puts "host:  #{host}"
puts "token: #{token.present? ? "present (#{token.length} chars)" : 'MISSING'}"
puts "file:  #{path} (#{File.size(path)} bytes)"

ext = File.extname(path).downcase
from = { ".docx" => "docx", ".odt" => "odt", ".epub" => "epub", ".html" => "html",
         ".htm" => "html", ".rst" => "rst", ".org" => "org", ".ipynb" => "ipynb",
         ".typ" => "typst", ".md" => "markdown", ".tex" => "latex" }[ext]
abort "no pandoc reader for #{ext}" unless from
puts "from:  #{from}"

uri = URI("https://#{host}/pandoc/")
request = Net::HTTP::Post.new(uri.request_uri)
File.open(path, "rb") do |file|
  request.set_form(
    [ [ "token", token ], [ "from", from ], [ "standalone", "yes" ],
      [ "file", file, { filename: File.basename(path), content_type: "application/octet-stream" } ] ],
    "multipart/form-data"
  )

  started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  begin
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: true,
                               open_timeout: 10, read_timeout: 120) { |http| http.request(request) }
    elapsed = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started).round(1)
    puts "\n--> HTTP #{response.code} in #{elapsed}s"
    puts response.body.to_s[0, 800]
  rescue StandardError => e
    elapsed = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started).round(1)
    puts "\n--> #{e.class}: #{e.message} after #{elapsed}s"
  end
end
