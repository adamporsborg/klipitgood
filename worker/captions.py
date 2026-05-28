#!/usr/bin/env python3
"""
captions.py — Burn word-highlighted captions onto a rendered clip.

Style matches reference: single unified white bar behind caption group,
large bold black text, #ee002a red for the active word.
Optional disclaimer bar at the very bottom of every frame.

Usage:
  python3 scripts/captions.py \
    --transcript /tmp/transcript.json \
    --segments '[{"start":0.0,"end":28.5}]' \
    --input output/clip.mp4 \
    --output output/clip_CAP.mp4 \
    --disclaimer "PAID FOR BY FRIENDS OF DAVE MARLON"
"""

import sys, json, argparse, re, os, tempfile, subprocess
from PIL import Image, ImageDraw, ImageFont

# ─── Constants ────────────────────────────────────────────────────────────────

VIDEO_W     = 1080
VIDEO_H     = 1920
# Font resolution: tries macOS paths first, then Linux/CI paths, then bundled
_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf",            # macOS
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",                    # macOS fallback
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",                 # Ubuntu built-in
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",         # Ubuntu alt
    os.path.join(os.path.dirname(__file__), "fonts", "Montserrat-ExtraBold.ttf"),  # bundled
]
FONT_PATH = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), None)
FONT_FALLBACK = FONT_PATH

# Caption bar — matches reference image
CAP_FONT_SIZE    = 84          # large, readable, matches reference
CAP_PAD_X        = 28          # horizontal padding inside bar
CAP_PAD_Y        = 16          # vertical padding inside bar
CAP_RADIUS       = 10          # rounded corners
CAP_WORD_GAP     = 14          # space between words inside bar
CAP_BAR_FILL     = (255, 255, 255, 255)   # pure white bar
CAP_TEXT_COLOR   = (18,  18,  18,  255)   # near-black
CAP_ACTIVE_COLOR = (238, 0,   42,  255)   # #ee002a red
MAX_WORDS        = 3

# Vertical position — 62% from top keeps captions well above any player UI
CAP_Y_FRAC       = 0.62

# Disclaimer bar at the very bottom
DISC_HEIGHT      = 74
DISC_FONT_SIZE   = 38
DISC_BAR_FILL    = (255, 255, 255, 255)
DISC_TEXT_COLOR  = (18,  18,  18,  255)

# Safety: captions must never extend below this (leaves room for disclaimer + phone UI)
SAFE_BOTTOM      = VIDEO_H - DISC_HEIGHT - 60


# ─── Font ─────────────────────────────────────────────────────────────────────

def get_font(size):
    path = FONT_PATH if os.path.exists(FONT_PATH) else FONT_FALLBACK
    return ImageFont.truetype(path, size)


def text_wh(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0], bb[3] - bb[1]


# ─── Timing ───────────────────────────────────────────────────────────────────

def retime_words(words, segments):
    retimed, cursor = [], 0.0
    for seg in segments:
        s0, s1 = seg["start"], seg["end"]
        for w in words:
            if w["start"] >= s0 - 0.08 and w["start"] < s1 + 0.05:
                cs = cursor + max(0.0, w["start"] - s0)
                ce = cursor + max(0.0, w["end"]   - s0)
                ce = min(ce, cursor + (s1 - s0))
                if ce > cs + 0.01:
                    retimed.append({"word": w["word"].strip(),
                                    "start": round(cs, 4), "end": round(ce, 4)})
        cursor += s1 - s0
    return retimed


def group_words(retimed):
    groups, cur = [], []
    for w in retimed:
        if not w["word"]:
            continue
        cur.append(w)
        if len(cur) >= MAX_WORDS or re.search(r"[.!?,;:]$", w["word"]):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


# ─── Frame renderer ───────────────────────────────────────────────────────────

def render_frame(group, active_idx, disclaimer_text, tmpdir, frame_idx):
    """
    Single white bar behind the whole group, active word in red, others black.
    Disclaimer bar always drawn at the bottom.
    """
    img  = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font      = get_font(CAP_FONT_SIZE)
    disc_font = get_font(DISC_FONT_SIZE)

    # ── Measure words ────────────────────────────────────────────────────────
    words_upper = [w["word"].upper() for w in group]
    sizes = [text_wh(draw, t, font) for t in words_upper]
    space_w = text_wh(draw, " ", font)[0]

    # Handle line wrapping if group is too wide
    max_row_px = VIDEO_W - 80
    lines = []
    line, line_w = [], 0
    for i, (t, (sw, sh)) in enumerate(zip(words_upper, sizes)):
        gap = space_w + CAP_WORD_GAP if line else 0
        if line_w + gap + sw > max_row_px and line:
            lines.append(line)
            line, line_w = [(i, t, sw, sh)], sw
        else:
            line.append((i, t, sw, sh))
            line_w += gap + sw
    if line:
        lines.append(line)

    row_h    = max(h for _, h in sizes)
    bar_h    = row_h + 2 * CAP_PAD_Y
    line_gap = 10
    total_h  = len(lines) * bar_h + (len(lines) - 1) * line_gap

    # ── Vertical position — centered at CAP_Y_FRAC, never below SAFE_BOTTOM ─
    cy = int(VIDEO_H * CAP_Y_FRAC) - total_h // 2
    if cy + total_h > SAFE_BOTTOM:
        cy = SAFE_BOTTOM - total_h
    cy = max(40, cy)

    # ── Draw each line ────────────────────────────────────────────────────────
    for line_words in lines:
        row_w = sum(sw for _, _, sw, _ in line_words)
        row_w += (len(line_words) - 1) * (space_w + CAP_WORD_GAP)
        bar_w  = row_w + 2 * CAP_PAD_X
        bx     = (VIDEO_W - bar_w) // 2

        # White bar
        draw.rounded_rectangle(
            [bx, cy, bx + bar_w, cy + bar_h],
            radius=CAP_RADIUS, fill=CAP_BAR_FILL
        )

        # Words
        tx = bx + CAP_PAD_X
        ty = cy + CAP_PAD_Y
        for word_i, t, sw, _ in line_words:
            color = CAP_ACTIVE_COLOR if word_i == active_idx else CAP_TEXT_COLOR
            draw.text((tx, ty), t, font=font, fill=color)
            tx += sw + space_w + CAP_WORD_GAP

        cy += bar_h + line_gap

    # ── Disclaimer bar (always) ───────────────────────────────────────────────
    if disclaimer_text:
        dy = VIDEO_H - DISC_HEIGHT
        draw.rectangle([0, dy, VIDEO_W, VIDEO_H], fill=DISC_BAR_FILL)
        dw, dh = text_wh(draw, disclaimer_text, disc_font)
        draw.text(
            ((VIDEO_W - dw) // 2, dy + (DISC_HEIGHT - dh) // 2),
            disclaimer_text, font=disc_font, fill=DISC_TEXT_COLOR
        )

    path = os.path.join(tmpdir, f"f{frame_idx:05d}.png")
    img.save(path, "PNG")
    return path


def render_blank(disclaimer_text, tmpdir):
    """Transparent frame with only the disclaimer bar."""
    img  = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if disclaimer_text:
        font = get_font(DISC_FONT_SIZE)
        dy   = VIDEO_H - DISC_HEIGHT
        draw.rectangle([0, dy, VIDEO_W, VIDEO_H], fill=DISC_BAR_FILL)
        dw, dh = text_wh(draw, disclaimer_text, font)
        draw.text(
            ((VIDEO_W - dw) // 2, dy + (DISC_HEIGHT - dh) // 2),
            disclaimer_text, font=font, fill=DISC_TEXT_COLOR
        )
    path = os.path.join(tmpdir, "blank.png")
    img.save(path, "PNG")
    return path


# ─── Overlay assembly ─────────────────────────────────────────────────────────

def build_overlay(groups, clip_duration, disclaimer_text, tmpdir):
    blank   = render_blank(disclaimer_text, tmpdir)
    entries = []
    cursor  = 0.0
    fi      = 0

    for group in groups:
        group_start = group[0]["start"]
        gap = group_start - cursor
        if gap > 0.03:
            entries.append((blank, gap))
        cursor = group_start

        for wi, word in enumerate(group):
            dur = max(0.04, word["end"] - word["start"])
            png = render_frame(group, wi, disclaimer_text, tmpdir, fi)
            entries.append((png, dur))
            fi += 1
            cursor = word["end"]

    tail = clip_duration - cursor
    if tail > 0.03:
        entries.append((blank, tail))

    concat_path  = os.path.join(tmpdir, "frames.txt")
    overlay_path = os.path.join(tmpdir, "overlay.webm")

    with open(concat_path, "w") as f:
        f.write("ffconcat version 1.0\n")
        for path, dur in entries:
            if dur < 0.02:
                continue
            f.write(f"file '{path}'\nduration {dur:.4f}\n")
        if entries:
            f.write(f"file '{entries[-1][0]}'\n")

    r = subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_path,
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-b:v", "0", "-crf", "30", "-deadline", "realtime",
        overlay_path,
    ], capture_output=True)

    if r.returncode != 0:
        print("Overlay encode failed:", r.stderr.decode()[-400:], file=sys.stderr)
        return None
    return overlay_path


def burn(input_mp4, overlay_webm, output_mp4):
    r = subprocess.run([
        "ffmpeg", "-y",
        "-i", input_mp4, "-i", overlay_webm,
        "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto[vout]",
        "-map", "[vout]", "-map", "0:a",
        "-af", "loudnorm=I=-14:TP=-1:LRA=11",
        "-c:v", "libx264", "-crf", "20", "-preset", "fast",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        output_mp4,
    ], capture_output=True)
    if r.returncode != 0:
        print("Burn-in failed:", r.stderr.decode()[-400:], file=sys.stderr)
        return False
    return True


def get_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
        capture_output=True, text=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def transcribe(video_path):
    """Transcribe a clip directly (used when no cached transcript exists)."""
    script = os.path.join(os.path.dirname(__file__), "transcribe.py")
    r = subprocess.run(
        ["python3", script, video_path],
        capture_output=True, timeout=300
    )
    if r.returncode != 0:
        return None
    return json.loads(r.stdout)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript",  help="Path to cached transcript JSON")
    ap.add_argument("--segments",    help="JSON [{start,end}] — omit to use full clip duration")
    ap.add_argument("--input",       required=True)
    ap.add_argument("--output",      required=True)
    ap.add_argument("--disclaimer",  default="")
    args = ap.parse_args()

    duration = get_duration(args.input)

    # Load or generate transcript
    if args.transcript and os.path.exists(args.transcript):
        with open(args.transcript) as f:
            transcript = json.load(f)
    else:
        print("  🎙  Transcribing clip...", flush=True)
        transcript = transcribe(args.input)
        if not transcript:
            print("Transcription failed", file=sys.stderr)
            sys.exit(1)

    segments = json.loads(args.segments) if args.segments else [{"start": 0.0, "end": duration}]

    retimed = retime_words(transcript["words"], segments)
    if not retimed:
        print("No words after retiming", file=sys.stderr)
        sys.exit(1)

    groups = group_words(retimed)

    with tempfile.TemporaryDirectory(prefix="klip_cap_") as tmpdir:
        print(f"  🖋  {sum(len(g) for g in groups)} word frames ({len(groups)} groups)...", flush=True)
        overlay = build_overlay(groups, duration, args.disclaimer.upper(), tmpdir)
        if not overlay:
            sys.exit(1)
        print("  🔥 Burning...", flush=True)
        if not burn(args.input, overlay, args.output):
            sys.exit(1)

    print(json.dumps({"output": args.output, "groups": len(groups)}))


if __name__ == "__main__":
    main()
