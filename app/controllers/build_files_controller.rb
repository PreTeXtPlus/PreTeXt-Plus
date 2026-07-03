class BuildFilesController < ApplicationController
  before_action :load_and_authorize_build

  def show
    file_data = cached_file_data(path)
    raise ActiveRecord::RecordNotFound unless file_data

    if file_data[:content_type] == "text/html"
      content = ActiveStorage::Blob.service.download(file_data[:blob_key])
      send_data content, type: "text/html", disposition: "inline"
    else
      redirect_to_cdn_url file_data[:blob_url]
    end
  end

  private

    def load_and_authorize_build
      @build = Build.find(params[:build_id])
      authorize! :read, @build
    end

    def path
      params[:relative_path]
    end

    def cached_file_data(path, _reattempt = true)
      candidate_paths(path).each do |candidate|
        data = Rails.cache.read(file_cache_key(candidate))
        return data if data
      end

      return nil unless _reattempt

      populate_build_file_cache
      cached_file_data(path, false)
    end

    def candidate_paths(path)
      path.blank? ?
        [ "index.html" ] :
        [ path, path.sub(/\.[^.]+\z/, ""), "#{path}.html", "#{path}/index.html" ]
    end

    def file_cache_key(relative_path)
      "build/#{@build.id}/file/#{relative_path}"
    end

    def populate_build_file_cache
      @build.build_files.with_attached_blob.each do |bf|
        next unless bf.blob.attached?

        Rails.cache.write(
          file_cache_key(bf.relative_path),
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
