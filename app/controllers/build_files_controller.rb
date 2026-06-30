class BuildFilesController < ApplicationController
  before_action :load_and_authorize_build

  def show
    @build_file = @build.file_at(path)
    raise ActiveRecord::RecordNotFound unless @build_file

    if @build_file.blob.content_type == "text/html"
      send_data @build_file.blob.download, type: "text/html", disposition: "inline"
    else
      redirect_to_cdn_url rails_blob_url(@build_file.blob)
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
end
