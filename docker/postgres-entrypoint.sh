#!/bin/bash
set -e

# Custom entrypoint for sgChat PostgreSQL
# Handles optional database reset on startup for development

# Check if we should reset on startup
if [ "$RESET_DB_ON_STARTUP" = "true" ]; then
    echo "🔄 RESET_DB_ON_STARTUP is enabled"
    
    # Check if postgres data directory exists and has data
    if [ -d "/var/lib/postgresql/data/base" ]; then
        echo "🗑️  Wiping existing database data..."
        # Remove all postgres data files to force re-initialization
        rm -rf /var/lib/postgresql/data/*
        echo "✅ Database data cleared - init.sql will run on startup"
    else
        echo "📦 Fresh database - init.sql will run on first startup"
    fi
fi

# Call the original postgres entrypoint
exec docker-entrypoint.sh "$@"
