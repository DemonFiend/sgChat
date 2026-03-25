# Local Dev Environment Guide

## Starting the environment
Open PowerShell, navigate to the docker folder and run:
  cd C:\Users\DemonFiend\Documents\LLMs\VibeCoding\sgChat-Server\docker
  docker compose -f docker-compose.local.yml up

## First time setup OR after a database wipe
Every time you wipe the database with `down -v` and start fresh,
you need to claim admin again. Steps:

1. Start the environment:
   docker compose -f docker-compose.local.yml up

2. Wait for this line in the logs:
   📋 API available at http://0.0.0.0:3000/api

3. Find your admin claim code by running this in a NEW PowerShell window:
   docker compose -f docker-compose.local.yml logs api 2>&1 | findstr /i "claim"

4. Open http://localhost:3124 in your browser

5. Register a new account (any email/password, this is local only)

6. Use the admin claim code to give your account admin permissions
   (usually a URL like http://localhost:3124/claim?code=XXXXXX
   or a code you enter somewhere in the app settings)

## Creating a dev admin account
After the environment is running, create a second admin account you can use
while the QA bot (or another session) uses the owner account:
  bash docker/create-dev-admin.sh

Defaults to demon@sosiagaming.com / 123qwe123 / DemonFiend.
Override with flags:
  bash docker/create-dev-admin.sh --email me@test.com --password secret --username Me

This works after every wipe — it queries server/role IDs dynamically.

## Wiping the database (full reset)
Run this to delete all local data and start completely fresh:
  docker compose -f docker-compose.local.yml down -v
  docker compose -f docker-compose.local.yml up
Then follow the "First time setup" steps above to claim admin again.

## Stopping without wiping data
Run this to stop everything but KEEP your local database:
  docker compose -f docker-compose.local.yml down
Start it again later with:
  docker compose -f docker-compose.local.yml up

## Rebuilding after code changes
If you changed your source code and want to test it:
  docker compose -f docker-compose.local.yml up --build

## Watching logs
See everything:
  docker compose -f docker-compose.local.yml logs -f
See only API logs:
  docker compose -f docker-compose.local.yml logs -f api
Last 50 lines of API logs:
  docker compose -f docker-compose.local.yml logs api --tail 50

## Your local URLs
  App:         http://localhost:3124
  MinIO files: http://localhost:3043
  MinIO admin: http://localhost:3044  (login: local_admin / local_minio_secret)
