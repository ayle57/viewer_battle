#!/usr/bin/env python3
"""Generate an original, copyright-free stylised world map for the
GeoGuessr sample content (replaces the Assassin's Creed Odyssey map).

Pure stdlib — value-noise landmasses on an ocean gradient, a coastline
halo, elevation-tinted land, a faint lat/long grid. Writes a PNG with a
raw zlib encoder (no PIL / sharp in this project).

    python3 scripts/gen-sample-map.py
"""
import struct
import zlib
import math
import random

W, H = 2048, 1280
random.seed(20260901)

# ---- value noise -----------------------------------------------------

def make_lattice(cols, rows):
    return [[random.random() for _ in range(cols + 1)] for _ in range(rows + 1)]

def smooth(t):
    return t * t * (3 - 2 * t)

def sample(lat, cols, rows, x, y):
    gx = x * cols
    gy = y * rows
    x0, y0 = int(gx), int(gy)
    fx, fy = smooth(gx - x0), smooth(gy - y0)
    x1, y1 = min(x0 + 1, cols), min(y0 + 1, rows)
    a = lat[y0][x0] + (lat[y0][x1] - lat[y0][x0]) * fx
    b = lat[y1][x0] + (lat[y1][x1] - lat[y1][x0]) * fx
    return a + (b - a) * fy

octaves = [(3, 1.0), (6, 0.55), (12, 0.3), (24, 0.16), (48, 0.09), (96, 0.05)]
lattices = [(c, make_lattice(c, max(1, c * H // W)), amp) for c, amp in octaves]
amp_total = sum(a for _, _, a in lattices)

def fbm(x, y):
    v = 0.0
    for cols, lat, amp in lattices:
        rows = len(lat) - 1
        v += sample(lat, cols, rows, x, y) * amp
    return v / amp_total

# second field for elevation variety on land
random.seed(777)
elev_lat = make_lattice(10, 6)

def elev(x, y):
    return sample(elev_lat, 10, 6, x, y)

# ---- palette -------------------------------------------------------

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

OCEAN_DEEP = (0x0d, 0x22, 0x3a)
OCEAN_SHELF = (0x1c, 0x4b, 0x6b)
COAST = (0x8f, 0xc9, 0xd6)
SAND = (0xd9, 0xc7, 0x9a)
GRASS = (0x6f, 0x8f, 0x4f)
HILL = (0x8a, 0x7a, 0x52)
PEAK = (0xe4, 0xdd, 0xcf)
GRID = (0xff, 0xff, 0xff)

SEA_LEVEL = 0.46
raw = bytearray()

for py in range(H):
    raw.append(0)  # PNG filter: none
    ny = py / (H - 1)
    for px in range(W):
        nx = px / (W - 1)
        n = fbm(nx, ny)
        # push the map's edges toward ocean so land doesn't run off the frame
        edge = min(nx, ny, 1 - nx, 1 - ny)
        n -= max(0.0, 0.16 - edge) * 2.2

        if n < SEA_LEVEL:
            depth = (SEA_LEVEL - n) / SEA_LEVEL
            col = lerp(OCEAN_SHELF, OCEAN_DEEP, min(1.0, depth * 1.5))
            if n > SEA_LEVEL - 0.02:
                col = lerp(COAST, col, (SEA_LEVEL - n) / 0.02)
        else:
            h = (n - SEA_LEVEL) / (1 - SEA_LEVEL)
            e = elev(nx, ny)
            h = min(1.0, h * (0.55 + e))
            if h < 0.06:
                col = SAND
            elif h < 0.45:
                col = lerp(GRASS, HILL, (h - 0.06) / 0.39)
            elif h < 0.8:
                col = lerp(HILL, PEAK, (h - 0.45) / 0.35)
            else:
                col = PEAK

        # faint graticule
        if (px % 128 < 1) or (py % 128 < 1):
            col = lerp(col, GRID, 0.10)

        raw.extend(col)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

out = "public/images/maps/sample-world-map.png"
open(out, "wb").write(png)
print(f"wrote {out}  {W}x{H}  {len(png) // 1024} KB")
