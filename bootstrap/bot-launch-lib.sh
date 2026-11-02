# Sourced by launch-cloud.sh and launch-local.sh (bash 3.2 safe, python3 only, no jq).
# Per-bot launch settings (Flo, 2 Nov 2026): a Breez (Bob) session pinged Gus's webhook at 11:09 Dubai because it
# inherited Gus's shell env. Now every launch: drops inherited BOT_*/FACTORY_PING_*/ANTHROPIC_API_KEY, loads ONLY
# ~/.config/factory-bots/<owner>.env for the repo's .claude/bot-owner, and refuses (exit 5) on any mismatch.
# Never prints or logs the URL or key values.
bl_die() { echo "launch refused: $*" >&2; exit 5; }

# Clean env: unset every inherited BOT_* var plus the legacy ping vars and the API key.
bl_clean_env() {
  local v
  for v in $(env | sed -n 's/^\(BOT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
  unset BOT_OWNER BOT_WEBHOOK_URL BOT_WEBHOOK_KEY FACTORY_PING_URL FACTORY_PING_KEY ANTHROPIC_API_KEY
}

# bl_fd <repo-dir> -> path of the repo's fleet-defaults (.claude/ first, then root); dies if none.
bl_fd() { bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/fleet/fleet-defaults.sh" --root "$1" path 2>/dev/null || bl_die "no .claude/fleet-defaults.json (or fleet-defaults.json) in $1"; }

# bl_pin <fleet-defaults.json> <requested model or ""> <requested effort or ""> -> BL_MODEL BL_EFFORT
bl_pin() {
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  BL_MODEL="$(bash "$here/scripts/fleet/fleet-defaults.sh" --file "$1" model)" || bl_die "cannot read model from $1"
  BL_EFFORT="$(bash "$here/scripts/fleet/fleet-defaults.sh" --file "$1" effort)" || bl_die "cannot read effort from $1"
  [ -z "$2" ] || [ "$2" = "$BL_MODEL" ] || bl_die "--model $2 differs from fleet-defaults.json ($BL_MODEL). Edit fleet-defaults.json + run scripts/fleet/sync-defaults.sh instead."
  [ -z "$3" ] || [ "$3" = "$BL_EFFORT" ] || bl_die "--effort $3 differs from fleet-defaults.json ($BL_EFFORT). Edit fleet-defaults.json + run scripts/fleet/sync-defaults.sh instead."
}

# bl_load_bot <repo-dir>: reads <repo>/.claude/bot-owner, loads that bot's env file, exports the three vars.
bl_load_bot() {
  local owner bl_bdir f k v bl_h
  bl_h="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/fleet/fleet-defaults.sh"
  owner="$(bash "$bl_h" --root "$1" owner 2>&1)" || bl_die "$owner"
  bl_bdir="${FACTORY_BOTS_DIR:-$HOME/.config/factory-bots}"; f="$bl_bdir/$owner.env"
  [ -f "$f" ] || bl_die "bot settings file $f is missing (create it, chmod 600, with BOT_OWNER=$owner, BOT_WEBHOOK_URL, BOT_WEBHOOK_KEY)"
  case "$(python3 -c 'import os,sys;print(oct(os.stat(sys.argv[1]).st_mode&0o077))' "$f" 2>/dev/null)" in
    0o0) ;; *) bl_die "$f is readable by group/others; run: chmod 600 $f";; esac
  local L_OWNER="" L_URL="" L_KEY="" line
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#export }"; case "$line" in [A-Z_]*=*) ;; *) continue;; esac
    k="${line%%=*}"; v="${line#*=}"
    case "$v" in \"*\") v="${v#\"}"; v="${v%\"}";; \'*\') v="${v#\'}"; v="${v%\'}";; esac
    case "$k" in BOT_OWNER) L_OWNER="$v";; BOT_WEBHOOK_URL) L_URL="$v";; BOT_WEBHOOK_KEY) L_KEY="$v";; esac
  done < "$f"
  [ "$L_OWNER" = "$owner" ] || bl_die "BOT_OWNER in $f is '${L_OWNER:-unset}' but this repo belongs to '$owner'"
  [ -n "$L_URL" ] || bl_die "BOT_WEBHOOK_URL is empty in $f"
  case "$L_URL" in https://*) ;; *) bl_die "BOT_WEBHOOK_URL in $f is not https (value not shown)";; esac
  [ -n "$L_KEY" ] || bl_die "BOT_WEBHOOK_KEY is empty in $f"
  BOT_OWNER="$L_OWNER"; BOT_WEBHOOK_URL="$L_URL"; BOT_WEBHOOK_KEY="$L_KEY"
  export BOT_OWNER BOT_WEBHOOK_URL BOT_WEBHOOK_KEY
  echo "bot settings: owner=$owner from $f (url/key loaded, not shown)" >&2
}
