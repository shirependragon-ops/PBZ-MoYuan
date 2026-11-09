"""Check only Git-indexed files; never print matching secret values."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "machine home path": r"[A-Za-z]:[\\/]+Users[\\/]+",
    "Steam account identifier": r"(?<!\d)7656119\d{10}(?!\d)",
    "GitHub credential": r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})",
    "API credential": r"\bsk-[A-Za-z0-9_-]{24,}",
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "credential URL": r"https?://[^\s/@:]+:[^\s/@]+@",
}
FORBIDDEN_DIRS = {".local", "work", "save-rescue", "tools", "dist", "node_modules"}
FORBIDDEN_SUFFIXES = {".sav", ".log", ".dmp", ".bak", ".zip", ".pak", ".ucas", ".utoc", ".exe", ".dll", ".key", ".pem"}

def check():
    listing = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    names = [n.decode("utf-8") for n in listing.split(b"\0") if n]
    if not names:
        raise RuntimeError("No Git-indexed files to check")
    failures = []
    for name in names:
        p = Path(name)
        if p.parts[0] in FORBIDDEN_DIRS or p.suffix.lower() in FORBIDDEN_SUFFIXES or p.name.startswith(".env"):
            failures.append((name, "excluded artifact"))
            continue
        content = (ROOT / p).read_text(encoding="utf-8")
        for label, pattern in PATTERNS.items():
            if re.search(pattern, content):
                failures.append((name, label))
    for name, label in failures:
        print(f"FAIL: {name}: {label}")
    if failures:
        return 1
    print(f"PASS: {len(names)} indexed text files; no forbidden artifacts or detected credentials, account IDs or home paths.")
    return 0

if __name__ == "__main__":
    sys.exit(check())
