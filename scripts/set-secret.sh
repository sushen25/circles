#!/usr/bin/env bash
# Sets one secret on a hosted Supabase project; `make secret` is the front door.
#
# The value never appears on a command line. A value typed as `V=…` lands in
# shell history, in the process list and in an agent's transcript, so it is
# read from standard input instead: hidden at a prompt when stdin is a
# terminal, or piped in (`pbpaste | make secret …`, `make secret … < key.p8`).
# It goes to the Supabase CLI in a private env file that is removed on exit.
#
#   set-secret.sh NAME            value from stdin
#   GENERATE=1 set-secret.sh NAME a fresh random value, shown to nobody
#
# Environment: SUPABASE (the CLI), REF (the project), ENV_NAME (for the message).
set -euo pipefail

key="${1:-}"
case "$key" in
  '' | [0-9]* | *[!A-Za-z0-9_]*)
    echo 'usage: make secret ENV=<dev|prod> K=NAME   (the value is read from stdin)' >&2
    exit 2
    ;;
esac

if [ "${GENERATE:-}" = 1 ]; then
  value="$(openssl rand -base64 32)"
elif [ -t 0 ]; then
  IFS= read -rs -p "Value for $key on ${ENV_NAME:-?} (hidden): " value
  echo >&2
  # A multi-line paste would leave its other lines in the terminal to be run as
  # commands, with the value in shell history. Refuse it.
  if IFS= read -rs -t 0.3 _extra; then
    echo "set-secret: the paste has more than one line; redirect a file instead: make secret ... < file" >&2
    exit 2
  fi
else
  value="$(cat)"
fi

if [ -z "$value" ]; then
  echo "set-secret: no value for $key; pipe it in, type it at the prompt, or pass GENERATE=1 for a random one" >&2
  exit 2
fi
case "$value" in
  *"'"*)
    echo "set-secret: the value contains a single quote, which an env file cannot hold; set it in the dashboard instead" >&2
    exit 2
    ;;
esac

# From an empty directory: `supabase secrets set` also sends the
# [edge_runtime.secrets] of any config.toml it finds walking up (see the
# Makefile). The env file lives there too and is removed with it.
umask 077
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
printf "%s='%s'\n" "$key" "$value" >"$dir/secret.env"

(cd "$dir" && "$SUPABASE" secrets set --project-ref "$REF" --env-file "$dir/secret.env")
echo "$key set on ${ENV_NAME:-?} ($REF)"
