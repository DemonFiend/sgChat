# Database Migrations

This folder contains SQL migration files for database schema changes.

## Running Migrations

### Manual Execution
Connect to your PostgreSQL database and run:

```bash
psql -U sgchat -d sgchat -f 001_add_popup_config.sql
```

### Docker Execution
If using Docker:

```bash
docker exec -i sgchat-postgres psql -U sgchat -d sgchat < packages/api/src/migrations/001_add_popup_config.sql
```

## Migration Files

- `001_add_popup_config.sql` - Adds popup_config JSONB column to servers table for storing admin-configurable popup settings

## Notes

- Migrations are idempotent (safe to run multiple times)
- Each migration checks for existence before making changes
- Migrations should be run in numerical order
