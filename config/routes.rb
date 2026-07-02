Rails.application.routes.draw do
  namespace :admin do
    root "dashboard#show"
    resources :users, only: %i[index show] do
      member do
        post :confirm
        post :reset_password
      end
    end
    resources :projects, only: %i[show]
    resources :terms, only: %i[new create]
    resources :announcements do
      member do
        post :publish
      end
    end
  end

  devise_for :users, skip: [ :registrations ], controllers: {
    sessions: "users/sessions",
    passwords: "users/passwords",
    confirmations: "users/confirmations"
  }
  resources :users, only: [ :new, :create, :edit, :update ]

  get "tos" => "terms#tos", as: "tos"
  get "privacy" => "terms#privacy", as: "privacy"
  get "subscriptions/invoice" => "subscriptions#invoice_request", as: "invoice_request"
  post "subscriptions/invoice" => "subscriptions#submit_invoice_request", as: "submit_invoice_request"
  resources :subscriptions, only: [ :index, :show ] do
    member do
      post "seat" => "subscriptions#seat", as: "seat"
    end
  end
  resources :subscription_types do
    member do
      get "checkout" => "subscription_types#checkout", as: "checkout"
    end
  end
  # PreTeXt's own built-in logo, referenced by every document's docinfo as a
  # plain `external/icon.svg` -- not a library asset at all, so it must be
  # caught and redirected to the static file *before* the project_assets
  # preview/share routes below (declaration order matters: this has to win the
  # match first, since `/projects/:id/preview|share/external/icon.svg` would
  # otherwise match those routes' `:ref` segment instead). Declared ahead of
  # `resources :projects` for that reason, even though it's otherwise
  # unrelated to the resource.
  get "*_/icon.svg", to: redirect("/icon-small.svg")
  resources :projects do
    resources :builds, only: [ :index, :show, :create, :destroy ]
    resources :divisions, only: [ :create ]
    # Immediate-persist membership endpoint (mirrors divisions): the editor adds
    # an asset to its own pool optimistically, then we write the join row here.
    # `destroy` keys on the library_asset id -- see ProjectAssetsController.
    resources :project_assets, only: [ :create, :destroy ]
    collection do
      post "feedback" => "projects#feedback", as: "feedback"
      get "lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get "*_/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get ":id/*_.html", to: redirect("/projects/%{id}/share")
    end
    member do
      get "share" => "projects#share", as: "share"
      get "share/source" => "projects#source", as: "share_source"
      get "share/copy", to: redirect("projects/%{project_id}/share/source")
      post "share/copy" => "projects#copy", as: "copy"
      get "(*_)/external/:ref" => "project_assets#share", as: "share_asset"
      post "preview" => "projects#preview", as: "preview"
      get "*/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
    end
  end
  scope format: true, constraints: { format: "json" } do
    resources :library_assets, path: "library", only: [ :index, :show, :create, :update, :destroy ]
  end
  resources :announcements, only: %i[index show]

  # A stable, asset-id-scoped redirect to the asset's current file location.
  # Used purely for the editor's own asset-manager thumbnails when browsing the
  # full cross-project library, where an asset may not yet belong to any
  # project (and so has no project-scoped ref to redirect through). Owner-only
  # -- only the authenticated author ever sees the asset manager. Kept outside
  # the json-only scope above since this redirects rather than rendering JSON.
  get "library/:id/file" => "library_assets#file", as: "library_asset_file"
  # Deprecated asset share link (used by old builds to serve up assets).
  get "share_assets/external/:id" => "library_assets#share_file", as: "share_asset_file"
  get "builds/:build_id/files(/*relative_path)", to: "build_files#show", as: "build_file", format: false
  resources :asset_fetches, only: :create
  get "tryit" => "projects#tryit"

  get "up" => "rails/health#show", as: :rails_health_check

  root "pages#home"
end
