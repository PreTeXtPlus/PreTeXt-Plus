docker exec pretext_plus-postgres-1 psql -U postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'pretext_plus_development';"