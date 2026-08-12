Rails.application.routes.draw do
  # Public output.
  #
  # Built PreTeXt links between its pages relatively ("chapter-1.html"), so the page a
  # visitor lands on must sit one level *inside* the target, or every internal link
  # resolves a directory too high. Rails normalizes trailing slashes away during route
  # recognition -- "/o/x/website" and "/o/x/website/" are indistinguishable by the time a
  # controller sees them -- so rather than depend on the raw path, both bare forms
  # redirect to an explicit index.html and the file route requires a path segment.
  #
  # format: false keeps ".html" in the path instead of being parsed as a response format.
  #
  # Published output is user-authored HTML *and JavaScript* (interactive figures are a
  # PreTeXt feature), so where a published origin is configured it is served from that
  # origin and only there: a script in a published page must not run on the origin that
  # holds sessions. This block is first because routes match top-down -- every
  # unconstrained route below would otherwise answer on the published origin too.
  # Development configures no published origin (Codespaces forwards exactly one host),
  # so the same routes mount on the app's own origin there. See docs/build-targets.md.
  # .presence, not a nil check: config.x never returns nil -- reading an unset key
  # auto-vivifies an empty OrderedOptions, which is truthy. Without it, development
  # (which deliberately configures no published origin) takes this branch with a nil
  # host and the app loses its routes.
  published_origin = Rails.application.config.x.published_url_options.presence
  if published_origin
    constraints host: published_origin[:host] do
      get "o/:project_id/:target_slug" => "published#redirect_to_index", as: :published
      get "o/:project_id/:target_slug/*relative_path" => "published#show",
          as: :published_file, format: false

      # The quick build (legacy share) is user HTML too, so it renders on this origin
      # as well: ProjectsController#share on the app origin bounces here first, which
      # is what keeps share links already in the world working while moving what they
      # serve off the session origin. Unnamed -- URL generation uses the
      # share_project_* helpers from the resources block below, with an explicit host.
      get "projects/:id/share" => "projects#share"

      # Nothing else answers on the published origin -- the login form above all, since
      # a page that can set or send a session cookie must never render on the origin
      # user scripts run on. Everything else bounces to the app origin (the mailer
      # host, the one canonical hostname the app already relies on).
      app_host = Rails.application.config.action_mailer.default_url_options[:host]
      get "/", to: redirect(host: app_host)
      match "*path", via: :all, format: false, to: redirect(host: app_host)
    end

    # A published link pasted against the app origin still lands somewhere useful.
    # Shaped like the real routes rather than a bare glob so a stray /o path 404s
    # instead of bouncing between the two origins forever.
    get "o/:project_id/:target_slug(/*relative_path)",
        to: redirect(published_origin.to_h), format: false
  else
    get "o/:project_id/:target_slug" => "published#redirect_to_index", as: :published
    get "o/:project_id/:target_slug/*relative_path" => "published#show",
        as: :published_file, format: false
  end

  namespace :admin do
    root "dashboard#show"
    resources :users, only: %i[index show] do
      member do
        post :confirm
        post :reset_password
        patch :update_email
      end
    end
    resources :projects, only: %i[show update]
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
  resources :users, only: [ :new, :create, :edit, :update ] do
    # Publisher options an author sets once and every project of theirs inherits. Nested
    # under the user for the same route shape as the project and target versions -- one
    # controller serves all three -- though like users#edit it always edits the signed-in
    # account, whatever id the path carries.
    resource :publication_settings, only: [ :edit, :update ]
  end
  # The leading "@" keeps this off the plain top-level namespace (no bare
  # "/:username" to collide with "/tos", "/subscriptions", etc.) while reading as a
  # public handle, the way it does on most other sites.
  get "@:username" => "users#show", as: :user_profile

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
    member do
      get "download" => "projects#download", as: "download"
    end
    resources :collaborations, only: [ :create, :destroy ]
    # Publisher options for every output of this project, overriding the owner's account
    # defaults; the one on a target below overrides these in turn.
    resource :publication_settings, only: [ :edit, :update ]
    resources :targets, only: [ :show, :create, :update, :destroy ] do
      member do
        patch "publish" => "targets#publish", as: "publish"
        patch "revert" => "targets#revert", as: "revert"
      end
      resource :publication_settings, only: [ :edit, :update ]
      # Builds are always attempts at a target, so that is where they are created.
      resources :builds, only: [ :create ]
    end
    # Kept nested under project rather than target: full_callback's absolute URL is
    # baked into in-flight submissions by FullBuildJob, so moving it would drop the
    # webhook for every build already running at deploy time.
    resources :builds, only: [ :show, :destroy ] do
      # Async status webhook from the full build server; authenticated by HMAC
      # signature, not login (see BuildCallbacksController).
      member do
        post "full_callback" => "build_callbacks#create", as: "full_callback"
        post "check_status" => "builds#check_status", as: "check_status"
        post "cancel" => "builds#cancel", as: "cancel"
      end
    end
    collection do
      get "owned"
      get "shared"
      post "from_template/:template_id" => "projects#create_from_template", as: "create_from_template"
      post "import" => "projects#create_from_import", as: "create_from_import"
      post "feedback" => "projects#feedback", as: "feedback"
      get "lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get "*_/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get ":id/*_.html", to: redirect("/projects/%{id}/share")
    end
    member do
      # Collaborative-editing doc persistence (live relay is ProjectDocChannel).
      get "doc" => "project_docs#show", as: "doc"
      post "doc/seed" => "project_docs#seed", as: "seed_doc"
      put "doc" => "project_docs#update"
      get "share" => "projects#share", as: "share"
      get "source" => "projects#source", as: "share_source"
      get "share/source" => "projects#source", to: redirect("/projects/%{id}/source")
      post "share/copy" => "projects#copy", as: "copy"
      get "(*_)/external/:ref" => "assets#share", as: "share_asset"
      get "(*_)/external/:ref/thumbnail" => "assets#share_thumbnail", as: "share_asset_thumbnail"
      post "preview" => "projects#preview", as: "preview"
      get "*/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
    end
  end
  resources :announcements, only: %i[index show]

  # Deprecated asset share link (used by old builds to serve up assets).
  get "share_assets/external/:id" => "assets#file", as: "share_asset_file"
  get "builds/:build_id/files(/*relative_path)", to: "build_files#show", as: "build_file", format: false
  get "builds/:build_id/zip", to: "build_files#zip", as: "build_zip"
  resources :asset_fetches, only: :create
  get "tryit" => "projects#tryit"
  post "tryit/preview" => "projects#preview", as: "tryit_preview"
  get "(tryit)/external/icon" => redirect("/icon.svg")

  # Where the editor reports collaboration failures only the browser can see.
  resources :collab_incidents, only: :create

  get "up" => "rails/health#show", as: :rails_health_check
  # Deliberately *not* folded into /up: this one can fail while the app is
  # perfectly healthy, and restarting the app over it would be the worse outage.
  # Point a monitor at it and alert on it. See CableHealthController.
  get "up/cable" => "cable_health#show", as: :cable_health_check

  root "pages#home"
end
