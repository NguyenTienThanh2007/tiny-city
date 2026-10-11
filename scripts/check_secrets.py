"""Scan worktree and all reachable Git blobs; never print matching secret values."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = [re.compile(rb'AIza[0-9A-Za-z_-]{35}'), re.compile(rb'gh[pousr]_[0-9A-Za-z]{36}'),
            re.compile(rb'github_pat_[0-9A-Za-z_]{70,}'), re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]

def scan() -> tuple[list[str], int]:
    failures = []
    files = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'], cwd=ROOT).decode().split('\0')
    for name in filter(None,files):
        path = ROOT/name
        if path.name.startswith('.env') and path.name != '.env.example':
            failures.append(f'Forbidden tracked configuration file: {name}')
        if path.is_file() and any(p.search(path.read_bytes()) for p in PATTERNS):
            failures.append(f'Secret signature in worktree file: {name}')
    objects = subprocess.check_output(['git','rev-list','--objects','--all'],cwd=ROOT).splitlines()
    hashes = [line.split(b' ',1)[0] for line in objects]
    raw = subprocess.check_output(['git','cat-file','--batch'],input=b'\n'.join(hashes)+b'\n',cwd=ROOT)
    offset = blobs = 0
    while offset < len(raw):
        end=raw.index(b'\n',offset); header=raw[offset:end].split(); offset=end+1
        size=int(header[2]); data=raw[offset:offset+size];offset+=size+1
        if header[1] == b'blob':
            blobs+=1
            if any(p.search(data) for p in PATTERNS):
                failures.append(f'Secret signature in historical blob: {header[0].decode()}')
    for path in (ROOT/'src').rglob('*'):
        if path.is_file() and re.search(rb'GEMINI_API_KEY|google.genai|VITE_[A-Z_]*(?:KEY|SECRET)',path.read_bytes()):
            failures.append(f'Provider credential/configuration reference in frontend: {path.relative_to(ROOT)}')
    return failures,blobs

if __name__ == '__main__':
    failures, blobs = scan()
    print(f'Secret scan: {blobs} historical blobs; {len(failures)} findings. Credential values are never printed.')
    for finding in failures: print(finding)
    raise SystemExit(bool(failures))
