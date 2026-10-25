#!/usr/bin/env python3
"""Promote an immutable publication only while it is the current main revision.

The Publish job serializes this operation with other publishers. Registry
promotion is its final step, after tests and the release artifact upload.
"""
import json
import os
from pathlib import Path
import subprocess

from deploy import IMAGE, REPOSITORY, validate_release


def promote(release, run_id, attempt, commit):
    release = validate_release(release, {'id': run_id, 'run_attempt': attempt, 'head_sha': commit})
    head = json.loads(subprocess.check_output([
        'gh', 'api', f'repos/{REPOSITORY}/git/ref/heads/main',
    ]))['object']['sha']
    run = json.loads(subprocess.check_output([
        'gh', 'api', f'repos/{REPOSITORY}/actions/runs/{run_id}',
    ]))
    if head != commit or run['run_attempt'] != attempt:
        print('Publication superseded; immutable release retained, main tag unchanged.')
        return False
    subprocess.run([
        'docker', 'buildx', 'imagetools', 'create', '--prefer-index=false',
        '--tag', IMAGE + ':main', release['image'],
    ], check=True)
    return True


if __name__ == '__main__':
    promote(json.loads(Path('release.json').read_text()), int(os.environ['GITHUB_RUN_ID']),
            int(os.environ['GITHUB_RUN_ATTEMPT']), os.environ['GITHUB_SHA'])
