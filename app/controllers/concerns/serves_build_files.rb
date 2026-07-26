# Serving one file out of a finished build's output.
#
# Shared by BuildFilesController (owner-facing, addressed by build id) and
# PublishedController (public, addressed by project + target name). Both resolve a
# request path against the same stored BuildFiles and hand back the same bytes; only
# how they decide *which* build, and who may see it, differs.
module ServesBuildFiles
  extend ActiveSupport::Concern

  private

    def serve_build_file(build, relative_path)
      file_data = cached_file_data(build, relative_path)
      raise ActiveRecord::RecordNotFound unless file_data

      if file_data[:content_type] == "text/html"
        content = ActiveStorage::Blob.service.download(file_data[:blob_key])
        send_data content, type: "text/html", disposition: "inline"
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
            blob_key: bf.blob.key
          },
          unless_exist: true
        )
      end
    end
end
