# Serving one file out of a finished build's output.
#
# Shared by BuildFilesController (owner-facing, addressed by build id) and
# PublishedController (public, addressed by project + target slug). Both resolve a
# request path against the same stored BuildFiles and hand back the same bytes; only
# how they decide *which* build, and who may see it, differs.
module ServesBuildFiles
  extend ActiveSupport::Concern

  private

    # `disposition: "attachment"` is how a single-file output (a PDF, a SCORM package) is
    # downloaded as itself rather than browsed. It redirects to storage like any other
    # non-html file, so a large package never occupies a web worker.
    #
    # blob_download_url may be missing from an entry cached before it was stored; falling
    # back to the inline URL serves the same bytes, just without the attachment header.
    #
    # `public:` is only ever true from PublishedController, and only for a target whose
    # kind is not a site (Target#make_current_build_public! is what actually flips the
    # object world-readable, on the same condition) -- everything else, including this
    # same file addressed through the login-only BuildFilesController, keeps getting a
    # signed URL against the storage provider's own domain.
    def serve_build_file(build, relative_path, disposition: "inline", public: false)
      file_data = cached_file_data(build, relative_path)
      raise ActiveRecord::RecordNotFound unless file_data

      cdn_host = Rails.application.config.x.cdn_url_options&.dig(:host) if public

      if disposition == "attachment"
        redirect_to_cdn_url(file_data[:blob_download_url] || file_data[:blob_url])
      elsif file_data[:content_type] == "text/html"
        content = ActiveStorage::Blob.service.download(file_data[:blob_key])
        send_data content, type: "text/html", disposition: "inline"
      elsif cdn_host
        redirect_to_cdn_url "https://#{cdn_host}/#{file_data[:blob_key]}"
      else
        redirect_to_cdn_url file_data[:blob_url]
      end
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

    def populate_build_file_cache(build)
      build.build_files.with_attached_blob.each do |bf|
        next unless bf.blob.attached?

        Rails.cache.write(
          file_cache_key(build, bf.relative_path),
          {
            content_type: bf.blob.content_type,
            blob_url: rails_blob_url(bf.blob),
            blob_download_url: rails_blob_url(bf.blob, disposition: "attachment"),
            blob_key: bf.blob.key
          },
          unless_exist: true
        )
      end
    end
end
