#!/bin/sh
set -eu

if [ "$(id -u)" = 0 ]; then
    chown node:node /data
    exec setpriv --reuid=node --regid=node --init-groups --no-new-privs "$@"
fi

exec "$@"
