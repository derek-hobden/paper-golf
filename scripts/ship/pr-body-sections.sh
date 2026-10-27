#!/usr/bin/env bash
# The sections of a pull request body, read one way for every script that needs
# them. Sourced, not executed. Bash 3.2 compatible.

# ship_body_section <body> <heading>: the lines under that heading, at any level
# (`#` to `######`) and in any case, up to the next heading. The match is the one
# scripts/ship/pr-video-script.sh uses for the narration's steps, so the check
# and the narration never disagree on where the section is. A body is CRLF when
# GitHub hands it back, so \r goes.
ship_body_section() {
  printf '%s\n' "$1" | tr -d '\r' | awk -v want="$2" '
    BEGIN { want = tolower(want) }
    {
      line = tolower($0)
      head = line
      sub(/^#+[[:space:]]*/, "", head)
      sub(/[[:space:]]*$/, "", head)
      if (line ~ /^#+/ && head == want) { inside = 1; next }
      if (line ~ /^#+[[:space:]]/) { inside = 0; next }
    }
    inside { print }'
}

# ship_body_steps <body>: the real steps of the `## How to see it` section, one a
# line, trimmed. A real step is a line with something on it that is not an HTML
# comment (one line or several), not a bare list marker (`-`, `*`, `+`, `1.`) and
# not the template's placeholder. Prints nothing when the section is missing or
# holds no step.
ship_body_steps() {
  ship_body_section "$1" 'how to see it' | awk '
    {
      line = $0
      out = ""
      # Drop every comment, including one that runs over several lines.
      while (line != "") {
        if (incomment) {
          i = index(line, "-->")
          if (i == 0) { line = ""; break }
          line = substr(line, i + 3)
          incomment = 0
        } else {
          i = index(line, "<!--")
          if (i == 0) { out = out line; line = ""; break }
          out = out substr(line, 1, i - 1)
          line = substr(line, i + 4)
          incomment = 1
        }
      }
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", out)
      if (out == "") next
      if (out ~ /^([-*+]|[0-9]+[.)])$/) next
      print out
    }'
}

# The one-line reason a pull request without steps is refused, the next step,
# and the example that says how to fix it. pr-video.sh prints them.
SHIP_STEPS_REASON="${SHIP_STEPS_REASON:-no ## How to see it section with a step in it}"
SHIP_STEPS_NEXT="${SHIP_STEPS_NEXT:-add a ## How to see it section to the pull request body with one step per line, for example: - open /?play=0&players=1&hole=1, - click Roll, - take a shot, - expect Strokes 1}"
SHIP_STEPS_EXAMPLE="${SHIP_STEPS_EXAMPLE:-Add this to the pull request body, with your own steps, one per line:

## How to see it

- open /?play=0&players=1&hole=1
- click Roll
- take a shot
- expect Strokes 1

A CI or logic change with no screen still writes steps (for example: open this pull request and read the blockers comment), and CI makes a motion explainer for it. AGENTS.md, PR explainer videos.}"
