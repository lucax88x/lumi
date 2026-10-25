#!/usr/bin/env python3
"""Opt-in Watchtower smoke test with a disposable registry, app and gateway.

Only randomly named test resources are changed or removed. No production
credentials, GitHub account or external registry publication are used.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def command(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_response(url, expected):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.read().decode().strip() == expected:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.5)
    raise AssertionError(f'{url} did not return {expected}')


def main():
    project = 'lumi-watchtower-test-' + secrets.token_hex(6)
    registry_port, app_port, gateway_port = [free_port() for _ in range(3)]
    image = f'localhost:{registry_port}/lumi:main'
    endpoint = command('docker', 'context', 'inspect', command('docker', 'context', 'show'),
                       '--format', '{{.Endpoints.docker.Host}}')
    if os.environ.get('DOCKER_HOST') and not os.environ.get('DOCKER_CONTEXT'):
        endpoint = os.environ['DOCKER_HOST']
    assert endpoint.startswith('unix:///'), 'Use a local Unix Docker socket'
    images = []
    with tempfile.TemporaryDirectory(prefix=project + '-') as temporary:
        directory = Path(temporary)
        (directory / 'registry-auth').mkdir()
        (directory / 'registry-auth/config.json').write_text('{"auths":{}}')
        (directory / 'config').mkdir()
        (directory / 'config/value').write_text('unchanged')
        (directory / 'Caddyfile').write_text(':8080 {\n reverse_proxy lumi:8080\n}\n')
        base = {
            'services': {
                'registry': {'image': 'registry:2.8.3', 'environment': {'REGISTRY_HTTP_ADDR': f'0.0.0.0:{registry_port}'},
                             'ports': [f'127.0.0.1:{registry_port}:{registry_port}']},
                'lumi': {'image': image, 'ports': [f'127.0.0.1:{app_port}:8080'],
                         'environment': {'LUMI_TEST_VALUE': 'preserved'},
                         'volumes': ['app-data:/data', str(directory / 'config') + ':/config:ro']},
                'excluded': {'image': image, 'volumes': ['excluded-data:/data']},
                'other-scope': {'image': image, 'volumes': ['other-data:/data'], 'labels': {
                    'com.centurylinklabs.watchtower.enable': 'true',
                    'com.centurylinklabs.watchtower.scope': project + '-other'}},
                'gateway': {'image': 'caddy:2', 'ports': [f'127.0.0.1:{gateway_port}:8080'],
                            'volumes': [str(directory / 'Caddyfile') + ':/etc/caddy/Caddyfile:ro']},
            },
            'volumes': {'app-data': {}, 'excluded-data': {}, 'other-data': {}},
        }
        (directory / 'compose.json').write_text(json.dumps(base))
        # Use the production overlay, overriding only test scope and schedule.
        # The local registry is reachable through Docker's pull API. Watchtower
        # can fall back to that API when its direct digest check cannot connect.
        override = {'services': {
            'lumi': {'labels': {'com.centurylinklabs.watchtower.scope': project}},
            'watchtower': {'environment': {
                'WATCHTOWER_SCOPE': project, 'WATCHTOWER_POLL_INTERVAL': '2',
            }, 'labels': {'com.centurylinklabs.watchtower.scope': project}},
        }}
        (directory / 'test.json').write_text(json.dumps(override))
        env = os.environ | {'LUMI_DOCKER_SOCKET': endpoint.removeprefix('unix://'),
                            'LUMI_WATCHTOWER_CONFIG': str(directory / 'registry-auth')}
        compose = ['docker', 'compose', '-p', project, '-f', str(directory / 'compose.json'),
                   '-f', str(ROOT / 'compose.watchtower.yaml'), '-f', str(directory / 'test.json')]

        def dc(*args):
            return command(*compose, *args, env=env)

        def container(service):
            return dc('ps', '-q', service)

        def inspect(service):
            return json.loads(command('docker', 'inspect', container(service)))[0]

        def build(version):
            (directory / 'index.html').write_text(version)
            (directory / 'Dockerfile').write_text(
                'FROM busybox:1.37.0\nCOPY index.html /www/index.html\n'
                'HEALTHCHECK --interval=1s --timeout=1s --retries=10 CMD wget -q -O /dev/null http://127.0.0.1:8080\n'
                'CMD ["sh", "-c", "test -f /data/marker || echo preserved > /data/marker; exec httpd -f -p 8080 -h /www"]\n')
            command('docker', 'build', '-t', image, str(directory))
            image_id = command('docker', 'image', 'inspect', image, '--format', '{{.Id}}')
            images.append(image_id)
            command('docker', 'push', image)
            return image_id

        try:
            print('Starting the disposable registry.', flush=True)
            dc('up', '-d', 'registry')
            wait_response(f'http://127.0.0.1:{registry_port}/v2/', '{}')
            first = build('version-one')
            dc('up', '-d', '--wait', 'lumi', 'excluded', 'other-scope', 'gateway')
            wait_response(f'http://127.0.0.1:{gateway_port}', 'version-one')
            unchanged = {name: container(name) for name in ('excluded', 'other-scope', 'gateway')}
            original = inspect('lumi')
            dc('up', '-d', '--no-deps', 'watchtower')
            print('Publishing the second fixture image and waiting for Watchtower.', flush=True)
            second = build('version-two')
            wait_response(f'http://127.0.0.1:{gateway_port}', 'version-two')
            assert inspect('lumi')['Image'] == second
            print('Updated Lumi; checking persistence, filtering and failure behavior.', flush=True)
            assert inspect('lumi')['Config']['Env'] == original['Config']['Env']
            assert inspect('lumi')['Mounts'] == original['Mounts']
            assert command('docker', 'exec', container('lumi'), 'cat', '/data/marker') == 'preserved'
            assert command('docker', 'exec', container('lumi'), 'cat', '/config/value') == 'unchanged'
            assert all(container(name) == identity for name, identity in unchanged.items())
            # An unchanged digest must not recreate the application.
            current = container('lumi')
            time.sleep(5)
            assert container('lumi') == current
            # A registry outage must leave the active version running.
            dc('stop', 'registry')
            time.sleep(5)
            assert container('lumi') == current
            wait_response(f'http://127.0.0.1:{app_port}', 'version-two')
            # Manual pin: stop the watcher and recreate Lumi using a retained ID.
            dc('stop', 'watchtower')
            pin = {'services': {'lumi': {'image': first, 'labels': {'com.centurylinklabs.watchtower.enable': 'false'}}}}
            (directory / 'pin.json').write_text(json.dumps(pin))
            command(*compose, '-f', str(directory / 'pin.json'), 'up', '-d', '--no-deps', '--pull', 'never', 'lumi', env=env)
            wait_response(f'http://127.0.0.1:{gateway_port}', 'version-one')
            assert inspect('lumi')['Image'] == first
            print('Watchtower smoke passed: update, scope, persistence, gateway, unchanged digest, registry outage and manual pin.')
        except BaseException:
            print(dc('logs', '--no-color', '--tail', '60', 'watchtower'))
            raise
        finally:
            dc('--profile', 'watchtower', 'down', '--volumes', '--remove-orphans')
            for image_id in set(images):
                subprocess.run(['docker', 'image', 'rm', image_id], capture_output=True, check=False)


if __name__ == '__main__':
    main()
