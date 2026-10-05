#!/usr/bin/env python3
"""Thin ~/plcos-backups so it never grows forever (Juan, 27 Sep 2026; docs/22-backups.md).

Usage: backup-prune.py <backup dir> <max GB> [--dry-run]
       aws s3 ls s3://bucket/prefix/ | backup-prune.py --list-stdin <prefix> <max GB>
The stdin mode prints only dropped object keys; it never deletes local files.

Files are plcos-real-<YYYYMMDDTHHMMZ>[-daily|-event].tar.gz.gpg; a name with no kind reads as an event.
plcos-cloud-<…> files (scripts/cloud-pull.sh --keep, the cloud's off-site copy) are thinned with them, as one series.
The older a backup is, the sparser the ones kept:
  - event backups (taken around a very large update): kept 2 days
  - dailies: every one for 14 days, then one per ISO week to 8 weeks, one per month to 12 months,
    then one per year
  - the newest backup is always kept
Then, while the total exceeds the cap, the oldest remaining backup goes, never the newest.
All the day, week and month limits are GUESSES; the 300 GB cap is Juan's.
"""
import os, re, sys
from datetime import datetime, timezone, timedelta

EVENT_DAYS = 2      # GUESS
ALL_DAILY_DAYS = 14 # GUESS
WEEKLY_WEEKS = 8    # GUESS
MONTHLY_MONTHS = 12 # GUESS

NAME = re.compile(r'^plcos-(?:real|cloud)-(\d{8}T\d{4}Z)(?:-(daily|event))?\.tar\.gz\.gpg$')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    listing = '--list-stdin' in sys.argv
    out, max_gb = args[0], float(args[1])
    now = datetime.now(timezone.utc)
    backups = []
    entries = (line.split(maxsplit=3) for line in sys.stdin) if listing else os.listdir(out)
    for entry in entries:
        if listing:
            if len(entry) != 4:
                continue
            _, _, size, f = entry
            f = f.rstrip('\n')
            m = re.fullmatch(r'(\d{8}T\d{6}Z)\.(?:dump|tar\.gz)\.gpg', f)
        else:
            f, m = entry, NAME.match(entry)
        if not m:
            continue
        at = datetime.strptime(m.group(1), '%Y%m%dT%H%M%SZ' if listing else '%Y%m%dT%H%MZ').replace(tzinfo=timezone.utc)
        path = os.path.join(out, f)
        backups.append({'f': f, 'path': path, 'at': at, 'kind': 'daily' if listing else m.group(2) or 'event', 'size': int(size) if listing else os.path.getsize(path)})
    backups.sort(key=lambda b: b['at'])
    if not backups:
        return
    newest = backups[-1]
    keep = {newest['f']}
    buckets = set()
    # Newest first, so each bucket keeps its most recent daily.
    for b in reversed(backups):
        age = now - b['at']
        if b['kind'] == 'event':
            if age <= timedelta(days=EVENT_DAYS):
                keep.add(b['f'])
            continue
        if age <= timedelta(days=ALL_DAILY_DAYS):
            key = ('day', b['at'].date())
        elif age <= timedelta(weeks=WEEKLY_WEEKS):
            key = ('week', tuple(b['at'].isocalendar()[:2]))
        elif age <= timedelta(days=31 * MONTHLY_MONTHS):
            key = ('month', (b['at'].year, b['at'].month))
        else:
            key = ('year', b['at'].year)
        if key not in buckets:
            buckets.add(key)
            keep.add(b['f'])
    kept = [b for b in backups if b['f'] in keep]
    cap = max_gb * 1024 ** 3
    while sum(b['size'] for b in kept) > cap and len(kept) > 1:
        oldest = next(b for b in kept if b is not newest)
        kept.remove(oldest)
        keep.discard(oldest['f'])
    for b in backups:
        if b['f'] in keep:
            continue
        if listing:
            print(b['path'])
            continue
        print(('would remove ' if dry else 'removed ') + b['f'])
        if not dry:
            for suffix in ('', '.sha256', '.reason'):
                try:
                    os.remove(b['path'] + suffix)
                except FileNotFoundError:
                    pass
    total = sum(b['size'] for b in kept) / 1024 ** 3
    if not listing:
        print(f'{len(kept)} backups kept, {total:.1f} GB of {max_gb:.0f} GB')


if __name__ == '__main__':
    main()
