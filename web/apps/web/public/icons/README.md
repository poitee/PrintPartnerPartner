# App Icons

The PWA manifest references `icon-192.png` and `icon-512.png`.

Run the generator script to produce them from `icon.svg`:

```bash
# Option A — Python stdlib (no deps)
python3 gen_png.py

# Option B — cairosvg
pip install cairosvg
python3 generate_icons.py

# Option C — rsvg-convert (apt)
sudo apt install librsvg2-bin
python3 generate_icons.py

# Option D — Inkscape CLI
inkscape icon.svg -w 192 -h 192 -o icon-192.png
inkscape icon.svg -w 512 -h 512 -o icon-512.png
```

The source artwork is `icon.svg` — a dark-navy background with the sky-blue
"P" glyph and green checkmark that matches the app's colour palette.
