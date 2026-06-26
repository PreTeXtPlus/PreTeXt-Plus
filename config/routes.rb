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
  resources :projects do
    resources :divisions, only: [ :create ]
    # Immediate-persist membership endpoint (mirrors divisions): the editor adds
    # an asset to its own pool optimistically, then we write the join row here.
    # `destroy` keys on the library_asset id -- see ProjectAssetsController.
    resources :project_assets, only: [ :create, :destroy ]
    collection do
      post "preview" => "projects#preview", as: "preview"
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
      get "*/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
    end
  end
  scope format: true, constraints: { format: "json" } do
    resources :library_assets, path: "library", only: [ :index, :show, :create, :update, :destroy ]
  end
  # PreTeXt's own built-in logo, referenced by every document's docinfo as a
  # plain `external/icon.svg` -- not a library asset at all, so it must be
  # caught and redirected to the static file *before* the asset routes below
  # (declaration order matters: this has to win the match first). Global
  # rather than scoped under /projects/, since the <base> tags injected for
  # preview/share resolve that relative reference to different, non-/projects
  # prefixes depending on context.
  get "*_/icon.svg", to: redirect("/icon-small.svg")
  # A stable, asset-id-scoped redirect to the asset's current file location.
  # Used as the `source` target for live preview builds (which need a real,
  # fetchable URL right now, not a project-scoped ref that may not be saved
  # yet) and for the editor's own asset-manager thumbnails. Owner-only --
  # only the authenticated author ever sees a live preview or the asset
  # manager. Kept outside the json-only scope above since this redirects
  # rather than rendering JSON.
  get "preview_assets/external/:id" => "library_assets#preview_file", as: "preview_asset_file"
  # Same idea, but fully public (no login required) -- this is the target
  # baked into a project's *saved* pretext_source, which is what renders on
  # the public /share page. Supersedes the old ref-based, project-scoped
  # show_asset_file: id-based lookup works regardless of whether the
  # project_asset join row has been saved yet.
  get "share_assets/external/:id" => "library_assets#share_file", as: "share_asset_file"
  resources :asset_fetches, only: :create
  get "tryit" => "projects#tryit"

  get "up" => "rails/health#show", as: :rails_health_check

  root "pages#home"
end
