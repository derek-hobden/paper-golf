"""The measurements behind scripts/ship/pr-video-audio-gate.sh, which holds the
thresholds and passes them in. Run it through that script, not by hand.

  python3 -I pr-video-audio-gate.py <video> <script> <report> <transcript-out> \
    <given-transcript or ""> NAME=VALUE...

Writes the report and exits 0 when every check passes, 1 when any fails, 2 on
a usage error. ffmpeg and ffprobe do the listening; faster-whisper, imported
only when no transcript is given, does the hearing.
"""

import json
import math
import re
import subprocess
import sys

NAMES = (
    "MAX_DURATION_DIFF_S", "MIN_SPEECH_RATIO", "SILENCE_NOISE_DB", "SILENCE_MIN_S",
    "MAX_SILENCE_RATIO", "TAIL_ALLOWANCE_S", "MAX_GAP_S", "MIN_LUFS", "MAX_LUFS",
    "MAX_WER", "MIN_COVERAGE", "MIN_LAST_FIFTH", "WHISPER_MODEL", "WHISPER_COMPUTE",
)
# Whisper writes small numbers as digits; the script spells them out.
NUMBERS = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen twenty"
).split()


def pct(x):
    return f"{round(x * 100)}%"


def threshold_pct(text):
    return pct(float(text))


def probe(video):
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
         "-show_entries", "format=duration", "-of", "json", video],
        capture_output=True, text=True, check=True)
    data = json.loads(res.stdout)
    streams = data.get("streams", [])
    fmt = float(data.get("format", {}).get("duration") or 0)

    def length(kind):
        for s in streams:
            if s.get("codec_type") == kind:
                return float(s.get("duration") or fmt)
        return None

    return length("video") or fmt, length("audio")


def listen(video, noise_db, min_s):
    """The silences, as (start, end) pairs, and the integrated loudness."""
    res = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", video, "-map", "0:a:0",
         "-af", f"silencedetect=noise={noise_db}dB:d={min_s},ebur128=framelog=quiet",
         "-f", "null", "-"],
        capture_output=True, text=True, check=True)
    log = res.stderr
    silences = []
    start = None
    for line in log.splitlines():
        m = re.search(r"silence_start: (-?[\d.]+)", line)
        if m:
            start = max(0.0, float(m.group(1)))
        m = re.search(r"silence_end: (-?[\d.]+)", line)
        if m and start is not None:
            silences.append((start, float(m.group(1))))
            start = None
    summary = log[log.rfind("Summary:"):] if "Summary:" in log else ""
    m = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summary)
    loudness = None
    if m and m.group(1) != "-inf":
        loudness = float(m.group(1))
    return silences, start, loudness


def merge(intervals):
    out = []
    for s, e in sorted(intervals):
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def words(text):
    out = []
    for w in re.sub(r"[^a-z0-9]+", " ", text.lower().replace("'", "").replace("\u2019", "")).split():
        out.append(NUMBERS[int(w)] if w.isdigit() and int(w) < len(NUMBERS) else w)
    return out


def word_error_rate(ref, hyp):
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1] / len(ref)


def heard_in_order(ref, hyp):
    """Which words of the script were heard, in order (a longest common subsequence)."""
    n, m = len(ref), len(hyp)
    table = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            table[i][j] = (table[i + 1][j + 1] + 1 if ref[i] == hyp[j]
                           else max(table[i + 1][j], table[i][j + 1]))
    matched = set()
    i = j = 0
    while i < n and j < m:
        if ref[i] == hyp[j]:
            matched.add(i)
            i += 1
            j += 1
        elif table[i + 1][j] >= table[i][j + 1]:
            i += 1
        else:
            j += 1
    return matched


def transcribe(video, model_name, compute):
    import numpy  # noqa: imported here so a given transcript needs neither
    from faster_whisper import WhisperModel

    # ffmpeg decodes, not PyAV: faster-whisper's own decoder breaks on newer PyAV.
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video, "-map", "0:a:0", "-f", "s16le", "-ac", "1",
         "-ar", "16000", "-"], capture_output=True, check=True).stdout
    audio = numpy.frombuffer(pcm, numpy.int16).astype(numpy.float32) / 32768.0
    model = WhisperModel(model_name, device="cpu", compute_type=compute)
    segments, _ = model.transcribe(audio, language="en", beam_size=5)
    return " ".join(s.text.strip() for s in segments)


def main(argv):
    if len(argv) != 5 + len(NAMES):
        print("usage: see scripts/ship/pr-video-audio-gate.sh", file=sys.stderr)
        return 2
    video, script_path, report_path, transcript_out, given = argv[:5]
    t = dict(a.split("=", 1) for a in argv[5:])
    if sorted(t) != sorted(NAMES):
        print("pr-video-audio-gate.py: wrong thresholds", file=sys.stderr)
        return 2
    f = {k: float(v) for k, v in t.items() if k not in ("WHISPER_MODEL", "WHISPER_COMPUTE")}
    lines, reasons = [], []

    vd, ad = probe(video)
    lines.append(f"video {vd:.1f} s, audio {'none' if ad is None else f'{ad:.1f} s'}")
    if ad is None:
        reasons.append("the video has no audio stream")
    else:
        if abs(ad - vd) > f["MAX_DURATION_DIFF_S"]:
            reasons.append(f"the audio lasts {ad:.1f} s and the video {vd:.1f} s, "
                           f"more than {t['MAX_DURATION_DIFF_S']} s apart")

        silences, open_start, loudness = listen(video, t["SILENCE_NOISE_DB"], t["SILENCE_MIN_S"])
        if open_start is not None:
            silences.append((open_start, ad))
        if ad < vd:
            silences.append((ad, vd))
        silences = [(max(0.0, s), min(vd, e)) for s, e in merge(silences) if min(vd, e) > s]
        total = sum(e - s for s, e in silences)
        tail = 0.0
        gaps = list(silences)
        if silences and silences[-1][1] >= vd - 0.05:
            s, e = silences[-1]
            tail = min(f["TAIL_ALLOWANCE_S"], e - s)
            gaps[-1] = (s, e - tail)
        counted = total - tail
        speech = max(0.0, vd - total)
        longest = max((e - s for s, e in gaps), default=0.0)
        lines.append(f"speech {speech:.1f} s ({pct(speech / vd)}), silence {total:.1f} s, "
                     f"{counted:.1f} s ({pct(counted / vd)}) counted after a {tail:.1f} s tail, "
                     f"longest gap {longest:.1f} s")
        if speech / vd < f["MIN_SPEECH_RATIO"]:
            reasons.append(f"speech covers {pct(speech / vd)} of the video, "
                           f"under {threshold_pct(t['MIN_SPEECH_RATIO'])}")
        if counted / vd > f["MAX_SILENCE_RATIO"]:
            reasons.append(f"silence is {pct(counted / vd)} of the video (not counting a tail of up to "
                           f"{t['TAIL_ALLOWANCE_S']} s), over {threshold_pct(t['MAX_SILENCE_RATIO'])}")
        for s, e in gaps:
            if e - s > f["MAX_GAP_S"]:
                reasons.append(f"a silent gap of {e - s:.1f} s at {s:.1f} s, over {t['MAX_GAP_S']} s")

        if loudness is None:
            lines.append("loudness: not measurable")
            reasons.append("the integrated loudness could not be measured (no audible audio)")
        else:
            lines.append(f"loudness {loudness:.1f} LUFS integrated")
            if not f["MIN_LUFS"] <= loudness <= f["MAX_LUFS"]:
                reasons.append(f"integrated loudness is {loudness:.1f} LUFS, "
                               f"outside {t['MIN_LUFS']} to {t['MAX_LUFS']} LUFS")

        ref = words(open(script_path, encoding="utf-8").read())
        heard = None
        if given:
            lines.append("transcript: given ($AUDIO_GATE_TRANSCRIPT), not Whisper")
            heard = open(given, encoding="utf-8").read()
        else:
            lines.append(f"transcript: whisper {t['WHISPER_MODEL']} ({t['WHISPER_COMPUTE']}, cpu)")
            try:
                heard = transcribe(video, t["WHISPER_MODEL"], t["WHISPER_COMPUTE"])
            except ImportError as err:
                reasons.append(f"faster-whisper is not installed, so what the voice says "
                               f"could not be checked against the script ({err})")
            except Exception as err:  # noqa: any failure to listen is a failed gate
                reasons.append(f"speech-to-text failed, so what the voice says could not be "
                               f"checked against the script ({err})")
        if heard is not None:
            with open(transcript_out, "w", encoding="utf-8") as out:
                out.write(heard.strip() + "\n")
            hyp = words(heard)
            if not ref:
                reasons.append("the narration script is empty")
            else:
                wer = word_error_rate(ref, hyp)
                matched = heard_in_order(ref, hyp)
                coverage = len(matched) / len(ref)
                k = max(1, math.ceil(len(ref) / 5))
                last = sum(1 for i in range(len(ref) - k, len(ref)) if i in matched) / k
                lines.append(f"word error rate {pct(wer)}, {pct(coverage)} of the script heard in order, "
                             f"{pct(last)} of its last fifth heard ({len(hyp)} words heard, {len(ref)} written)")
                if wer > f["MAX_WER"]:
                    reasons.append(f"word error rate {pct(wer)} against the script, "
                                   f"over {threshold_pct(t['MAX_WER'])}")
                if coverage < f["MIN_COVERAGE"]:
                    reasons.append(f"{pct(coverage)} of the script was heard in order, "
                                   f"under {threshold_pct(t['MIN_COVERAGE'])}")
                if last < f["MIN_LAST_FIFTH"]:
                    reasons.append(f"{pct(last)} of the last fifth of the script was heard, "
                                   f"under {threshold_pct(t['MIN_LAST_FIFTH'])}")

    verdict = "FAIL" if reasons else "PASS"
    with open(report_path, "w", encoding="utf-8") as out:
        out.write(f"audio-gate: {verdict}\n")
        for line in lines:
            out.write(line + "\n")
        for reason in reasons:
            out.write(f"reason: {reason}\n")
    return 1 if reasons else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
