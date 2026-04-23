Rails.application.routes.draw do
  namespace :admin do
    root "dashboard#show"
    resources :users, only: %i[index show]
    resources :projects, only: %i[show]
  end

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
  resources :requests, only: [ :create ]
  resource :session
  resources :passwords, param: :token
  resources :users, only: [ :new, :create, :update ]
  resources :invitations, only: [ :new, :create ]
  post "invitations/redeem" => "invitations#redeem", as: :redeem_invitation
  get "projects/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
  get "projects/*_/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
  get "projects/:id/*_.html", to: redirect("/projects/%{id}/share")
  get "projects/*_/icon.svg", to: redirect("/icon-small.svg")
  resources :projects do
    member do
      get  :editor_state
      patch :editor_state, action: :update_editor_state
      get "share" => "projects#share", as: "share"
      get "share/source" => "projects#source", as: "share_source"
      get "share/copy", to: redirect("projects/%{project_id}/share/source")
      post "share/copy" => "projects#copy", as: "copy"
      post "copy_conversion" => "projects#copy_conversion", as: "copy_conversion"
      get "*/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
    end
  end
  post "projects/preview" => "projects#preview", as: "preview"
  post "projects/feedback" => "projects#feedback", as: "feedback"
  post "subscribe" => "subscriptions_old#subscribe"
  post "stripe/webhooks" => "subscriptions_old#webhooks"
  get "tryit" => "projects#tryit"
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  # Defines the root path route ("/")
  root "pages#home"
end
