#!/usr/bin/env bash
# Reads fleet-defaults.json (python3 only, no jq; bash 3.2 safe).
# Shared lookup helper for every fleet script. Canonical locations in a repo: .claude/fleet-defaults.json and
# .claude/bot-owner; fallback: repo-root fleet-defaults.json / bot-owner. The template itself uses .claude/fleet-defaults.json.
# Usage: fleet-defaults.sh [--file F] [--root DIR] model|effort|compact|path|owner|owner-path
#   owner: trimmed + lowercased; exit 5 if missing or not ^[a-z0-9-]+$ after that.
set -eu
file=""; root="${CLAUDE_PROJECT_DIR:-$PWD}"
while [ $# -gt 1 ]; do case "$1" in --file) file="$2"; shift 2;; --root) root="$2"; shift 2;; *) break;; esac; done
key="${1:?model|effort|compact|path|owner|owner-path}"
case "$key" in owner|owner-path)
  of=""; for f in "$root/.claude/bot-owner" "$root/bot-owner"; do [ -f "$f" ] && { of="$f"; break; }; done
  [ -n "$of" ] || { echo "no .claude/bot-owner (or bot-owner) under $root" >&2; exit 5; }
  [ "$key" = owner-path ] && { echo "$of"; exit 0; }
  o="$(tr -d ' \t\r\n' < "$of" | tr 'A-Z' 'a-z')"; raw="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$of" | sed '/^$/d')"
  [ "$(printf '%s' "$raw" | tr 'A-Z' 'a-z')" = "$o" ] || { echo "$of must hold one lowercase token (gus|bob|rob|mel|flo|cat|dan)" >&2; exit 5; }
  case "$o" in ''|*[!a-z0-9-]*) echo "$of must hold one token matching ^[a-z0-9-]+\$" >&2; exit 5;; esac
  echo "$o"; exit 0;;
esac
if [ -z "$file" ]; then
  for f in "$root/.claude/fleet-defaults.json" "$root/fleet-defaults.json"; do [ -f "$f" ] && { file="$f"; break; }; done
fi
[ -n "$file" ] && [ -f "$file" ] || { echo "fleet-defaults.json not found under $root" >&2; exit 3; }
[ "$key" = path ] && { echo "$file"; exit 0; }
python3 - "$file" "$key" <<'PY'
import json,re,sys
d=json.load(open(sys.argv[1])); k={"model":"model","effort":"effort","compact":"autoCompactWindow"}.get(sys.argv[2])
if not k: sys.exit("unknown key "+sys.argv[2])
v=str(d.get(k,""))
if not re.fullmatch(r"[A-Za-z0-9._\[\]-]+",v): sys.exit("bad or missing %s in %s"%(k,sys.argv[1]))
print(v)
PY
