#!/usr/bin/env python3
"""Resolve a trusted publication, then enter serviceman's authenticated shell.

Only code and public release metadata cross SSH. Configuration and registry
credentials are read exclusively inside serviceman's environment.
"""

import argparse
import base64
import io
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import sys
import zipfile

REPOSITORY = 'lucax88x/lumi'
IMAGE = 'ghcr.io/' + REPOSITORY
WORKFLOW = 'publish.yml'
RELEASE_ID = re.compile(r'[1-9][0-9]*-[1-9][0-9]*\Z')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}\Z')
COMMIT = re.compile(r'[0-9a-f]{40}\Z')


class DeployError(Exception):
    pass


class GitHub:
    def __init__(self):
        # Select this account for these subprocesses only, even if the global
        # account or inherited environment points at a work account.
        self.env = os.environ.copy()
        for key in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_DEBUG'):
            self.env.pop(key, None)
        token = subprocess.run(
            ['gh', 'auth', 'token', '--hostname', 'github.com', '--user', 'lucax88x'],
            env=self.env.copy(), capture_output=True, check=False,
        )
        if token.returncode or not token.stdout.strip():
            raise DeployError('Sign in to github.com as lucax88x with gh auth login first.')
        self.env['GH_TOKEN'] = token.stdout.decode().strip()

    def api(self, path, binary=False):
        result = subprocess.run(
            ['gh', 'api', '--hostname', 'github.com', 'repos/' + REPOSITORY + '/' + path],
            env=self.env, capture_output=True, check=False,
        )
        if result.returncode:
            # Do not echo arbitrary CLI diagnostics or environment values.
            raise DeployError('GitHub API request failed; check personal-account repository access.')
        return result.stdout if binary else json.loads(result.stdout)


def validate_run(run, workflow_id):
    workflow_path = '.github/workflows/' + WORKFLOW
    if not (
        run.get('workflow_id') == workflow_id
        # GitHub can return the workflow path with its ref appended.
        and run.get('path') in (workflow_path, workflow_path + '@main', workflow_path + '@refs/heads/main')
        and run.get('head_branch') == 'main'
        and run.get('event') in ('push', 'workflow_dispatch')
        and run.get('status') == 'completed'
        and run.get('conclusion') == 'success'
        and run.get('repository', {}).get('full_name') == REPOSITORY
        and run.get('head_repository', {}).get('full_name') == REPOSITORY
        and COMMIT.fullmatch(run.get('head_sha', ''))
        and type(run.get('id')) is int and run['id'] > 0
        and type(run.get('run_attempt')) is int and run['run_attempt'] > 0
    ):
        raise DeployError('Select a successful Publish run from lucax88x/lumi on main.')
    return run


def validate_release(release, run):
    expected = {
        'schema': 1,
        'repository': REPOSITORY,
        'release_id': f"{run['id']}-{run['run_attempt']}",
        'run_id': run['id'],
        'run_attempt': run['run_attempt'],
        'commit': run['head_sha'],
    }
    if (any(release.get(k) != v for k, v in expected.items())
            or not DIGEST.fullmatch(release.get('digest', ''))
            or release.get('image') != IMAGE + '@' + release['digest']):
        raise DeployError('Release artifact does not match the workflow run and expected image digest.')
    # Send only the defined metadata, never arbitrary extra artifact fields.
    return {**expected, 'digest': release['digest'], 'image': release['image']}


def resolve_release(github, run_id=None):
    workflow = github.api('actions/workflows/' + WORKFLOW)
    if run_id:
        run = validate_run(github.api('actions/runs/' + run_id), workflow['id'])
        if run['id'] != int(run_id):
            raise DeployError('GitHub returned a different workflow run than requested.')
    else:
        runs = github.api('actions/workflows/' + WORKFLOW + '/runs?branch=main&status=success&per_page=100')
        candidates = []
        for item in runs['workflow_runs']:
            try:
                candidates.append(validate_run(item, workflow['id']))
            except DeployError:
                continue
        if not candidates:
            raise DeployError('No successful publication on main was found.')
        run = max(candidates, key=lambda r: (r['created_at'], r['id']))
    name = f"lumi-release-{run['id']}-{run['run_attempt']}"
    artifacts = github.api(f"actions/runs/{run['id']}/artifacts?per_page=100")['artifacts']
    matching = [a for a in artifacts if a['name'] == name and not a['expired']]
    if len(matching) != 1:
        raise DeployError('Publication metadata is missing or expired; publish again or use --rollback.')
    artifact_id = matching[0]['id']
    if type(artifact_id) is not int or artifact_id <= 0:
        raise DeployError('Invalid artifact ID.')
    archive = github.api(f'actions/artifacts/{artifact_id}/zip', binary=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        if bundle.namelist() != ['release.json'] or bundle.getinfo('release.json').file_size > 16384:
            raise DeployError('Unexpected release artifact contents.')
        return validate_release(json.loads(bundle.read('release.json')), run)


def remote_command(action, argument, marker):
    runner = Path(__file__).with_name('deploy-remote.sh').read_bytes()
    encoded = base64.b64encode(runner).decode('ascii')
    # This EXIT trap belongs to the shell invoked by machinectl. Its status is
    # authoritative; machinectl's own status says nothing about the child.
    wrapper = (
        "trap 'status=$?; printf \"\\n" + marker + ":%s\\n\" \"$status\"' EXIT\n"
        + 'runner=$(printf %s ' + shlex.quote(encoded) + ' | base64 -d) || exit $?\n'
        + '/bin/bash -c "$runner" -- '
        + shlex.join([action, argument]) + '\nexit $?'
    )
    return shlex.join(['machinectl', 'shell', 'serviceman@.host', '/bin/bash', '-lc', wrapper])


def completion_status(output, marker, ssh_status):
    matches = re.findall(rb'(?:^|\n)' + marker.encode() + rb':([0-9]{1,3})\r?(?=\n|$)', output)
    if ssh_status or len(matches) != 1:
        raise DeployError('SSH ended without confirmed completion (authentication cancelled or connection lost). Check server state before retrying.')
    status = int(matches[0])
    if status:
        raise DeployError(f'Serviceman command failed with status {status}.')


def run_remote(action, argument):
    marker = 'LUMI_COMPLETE_' + secrets.token_hex(24)
    command = remote_command(action, argument, marker)
    # stdin remains attached to the user's terminal for SSH and Polkit prompts.
    process = subprocess.Popen(['ssh', '-tt', 'lumi-server', command], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = b''
    try:
        while True:
            chunk = os.read(process.stdout.fileno(), 4096)
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
            tail = (tail + chunk)[-65536:]
        completion_status(tail, marker, process.wait())
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--setup', action='store_true')
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--rollback', metavar='RELEASE_ID')
    parser.add_argument('--run', metavar='RUN_ID')
    args = parser.parse_args()
    if args.run and (args.setup or args.rollback):
        parser.error('--run can be combined only with --check or deployment')
    if args.run and not re.fullmatch(r'[1-9][0-9]*', args.run):
        parser.error('RUN_ID must be a positive integer')
    if args.rollback and not RELEASE_ID.fullmatch(args.rollback):
        parser.error('RELEASE_ID must have the form RUN_ID-RUN_ATTEMPT')
    if args.setup:
        run_remote('setup', '')
    elif args.rollback:
        run_remote('rollback', args.rollback)
    else:
        release = resolve_release(GitHub(), args.run)
        print(f"Release {release['release_id']} ({release['commit']}): {release['image']}", flush=True)
        run_remote('check' if args.check else 'deploy', json.dumps(release, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except (DeployError, OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(f'Deploy: {error}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('Deploy interrupted; check server state before retrying.', file=sys.stderr)
        sys.exit(130)
