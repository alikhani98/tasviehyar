#!/bin/sh
set -eu
umask 077
QUAL_BASE=/home/jtphyqur/.private
QUAL_NAME="tasviehyar-qual-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
QUAL_PATH="$QUAL_BASE/$QUAL_NAME"
case "$QUAL_PATH" in "$QUAL_BASE"/*) ;; *) echo 'unsafe qualification path' >&2; exit 2 ;; esac
exec php "$(dirname "$0")/cli-qualification.php" --path="$QUAL_PATH"
