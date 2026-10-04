#!/bin/sh
set -eu
umask 077

# Railway mounts a new volume as root. Prepare only this fixed mount directory,
# then drop privileges before migrations, custom commands or the web server.
if [ "$(id -u)" = 0 ]; then
  if [ -L /data ] || [ ! -d /data ]; then
    echo 'The /data volume must be a real directory.' >&2
    exit 1
  fi
  chown node:node /data
  chmod 700 /data
  exec gosu node "$0" "$@"
fi

if [ "${1:-}" != serve ]; then
  exec "$@"
fi

if [ -n "${RAILWAY_ENVIRONMENT_ID:-}" ] && [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" != /data ]; then
  echo 'Railway startup requires the persistent volume at /data.' >&2
  exit 1
fi

# Volumes are unavailable to Railway build/pre-deploy commands. Migrate here,
# with the actual volume mounted, and stop startup on any migration failure.
./node_modules/.bin/prisma migrate deploy
# Replay durable erasure intents before restored or restarted data is served.
node scripts/recovery.mjs reconcile --service
exec ./node_modules/.bin/react-router-serve ./build/server/index.js
