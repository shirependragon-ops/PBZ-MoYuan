"""Build the mod-only archive from an explicit file allowlist."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
DISPLAY_VERSION = VERSION.removesuffix(".0")
MODS = "ProjectPBZ/PBZModLoader/mods"
FILES = [
    "README-install.txt",
    "LICENSE",
    "NOTICE",
    f"{MODS}/PBZMoYuanClean/main.js",
    f"{MODS}/PBZLowHPBuff/main.js",
    f"{MODS}/PBZMoYuanSettings/config.json",
    f"{MODS}/PBZMoYuanSettings/settings.js",
    f"{MODS}/PBZMoYuanSettings/monster-ids.json",
    f"{MODS}/PBZMoYuanSettings/配置说明.md",
]

def build():
    for name in FILES:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(name)
    output = ROOT / "dist" / f"PBZ-MoYuan-{DISPLAY_VERSION}-mod.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in FILES:
            # Stable timestamps and explicit paths; never walk private work folders.
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 9, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, (ROOT / name).read_bytes())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(FILES)
        for name in FILES:
            assert archive.read(name) == (ROOT / name).read_bytes()
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".zip.sha256").write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    print(f"Built {output.relative_to(ROOT)} ({len(FILES)} files), CRC and contents verified.")

if __name__ == "__main__":
    build()
