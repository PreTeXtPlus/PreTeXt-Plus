# Serving one file out of a finished build's output.
#
# Shared by BuildFilesController (owner-facing, addressed by build id) and
# PublishedController (public, addressed by project + target slug). Both resolve a
# request path against the same stored BuildFiles and hand back the same bytes; only
# how they decide *which* build, and who may see it, differs.
module ServesBuildFiles
  extend ActiveSupport::Concern

  # Rails forces SVGs to download rather than display inline by default, since an SVG
  # can carry a <script> (a stored-XSS precaution) -- see Asset::INLINE_OVERRIDE_CONTENT_TYPES
  # for the same override applied to uploaded assets. Build output already runs
  # unrestricted author JavaScript inline (the html branch below, and the whole point of
  # PublishedController), so an embedded SVG's script is no new capability; without this,
  # an <img src="diagram.svg"> in built output downloads instead of rendering.
  INLINE_OVERRIDE_CONTENT_TYPES = %w[ image/svg+xml ].freeze

  # A fixed banner survives whatever CSS the built page ships, so a private preview can
  # never be mistaken for the finished public site while it's open in a tab.
  PRIVATE_PREVIEW_BANNER = (
    '<div style="background:#78350f;color:#fef3c7;font:14px/1.4 sans-serif;' \
    'text-align:center;padding:8px 12px;">' \
    "This private preview is only available to authors. This link won't work for anyone else." \
    "</div>"
  ).freeze

  private

    # `disposition: "attachment"` is how a single-file output (a PDF, a SCORM package) is
    # downloaded as itself rather than browsed. It redirects to storage like any other
    # non-html file, so a large package never occupies a web worker.
    def serve_build_file(build, relative_path, disposition: "inline", private_preview: false)
      file_data = cached_file_data(build, relative_path)
      raise ActiveRecord::RecordNotFound unless file_data

      if disposition == "attachment"
        redirect_to_cdn_url blob_signed_url(file_data, disposition: "attachment")
      elsif file_data[:content_type] == "text/html"
        content = ActiveStorage::Blob.service.download(file_data[:blob_key])
        content = inject_private_preview_banner(content) if private_preview
        send_data content, type: "text/html", disposition: "inline"
      else
        redirect_to_cdn_url blob_signed_url(file_data, disposition: "inline")
      end
    end

    # Nokogiri's HTML5 parser always resolves a real <body> to prepend into -- even for a
    # bodyless fragment, which build output can be (see the fixtures) -- so there is no
    # separate fallback path to maintain the way a regex against "<body>" would need.
    def inject_private_preview_banner(html)
      doc = Nokogiri::HTML5(html)
      doc.at_css("body")&.prepend_child(Nokogiri::HTML5.fragment(PRIVATE_PREVIEW_BANNER))
      doc.to_html
    end

    def cached_file_data(build, path, reattempt = true)
      candidate_paths(path).each do |candidate|
        data = Rails.cache.read(file_cache_key(build, candidate))
        return data if data
      end

      return nil unless reattempt

      populate_build_file_cache(build)
      cached_file_data(build, path, false)
    end

    # PreTeXt emits links in several shapes ("chapter", "chapter.html", a directory), so
    # a request path is matched against each plausible spelling before giving up. Note
    # this only ever *matches* stored relative_paths -- a traversal like "../secret"
    # simply fails to match rather than escaping anywhere.
    def candidate_paths(path)
      path.blank? ?
        [ "index.html" ] :
        [ path, path.sub(/\.[^.]+\z/, ""), "#{path}.html", "#{path}/index.html" ]
    end

    def file_cache_key(build, relative_path)
      "build/#{build.id}/file/#{relative_path}"
    end

    # Only stable attributes are cached -- never a signed URL. A signed URL is only
    # valid for ActiveStorage.service_urls_expire_in (5 minutes by default), but this
    # cache entry itself lives far longer (indefinitely, until evicted), so a URL baked
    # in at population time would go on being handed out -- and failing storage with
    # "Request has expired" -- long after it stopped working. blob_signed_url mints a
    # fresh one on every request instead.
    def populate_build_file_cache(build)
      build.build_files.with_attached_blob.each do |bf|
        next unless bf.blob.attached?

        Rails.cache.write(
          file_cache_key(build, bf.relative_path),
          {
            content_type: bf.blob.content_type,
            filename: bf.blob.filename.to_s,
            blob_key: bf.blob.key
          },
          unless_exist: true
        )
      end
    end

    # Signs a URL straight from the cached key/filename/content_type, via an unpersisted
    # Blob -- key/filename/content_type are plain attributes, so #url needs no query
    # beyond the cache read that supplied them.
    #
    # #url is called directly (as Asset#url does) rather than going through
    # rails_blob_url, whose redirect route would land on the app's own host -- one hop
    # too many for redirect_to_cdn_url to rewrite to the Spaces CDN subdomain.
    def blob_signed_url(file_data, disposition:)
      blob = ActiveStorage::Blob.new(key: file_data[:blob_key], filename: file_data[:filename],
        content_type: file_data[:content_type])

      # Bypasses Blob#url's forced-binary/forced-attachment logic for content types in
      # INLINE_OVERRIDE_CONTENT_TYPES, the same way Asset#url does for uploaded assets --
      # but only when inline was actually requested, so an explicit "attachment" for one
      # of these types (still forced attachment by Blob#url below) is unaffected.
      if disposition == "inline" && INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type)
        return blob.service.url(blob.key, expires_in: ActiveStorage.service_urls_expire_in,
          filename: blob.filename, content_type: blob.content_type, disposition: :inline)
      end

      blob.url(disposition: disposition)
    end
end
