#!/usr/bin/env python3
"""Local subprocess doubles; never contact SSH, a registry, or Docker."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

name = Path(sys.argv[0]).name
args = sys.argv[1:]
state = Path(os.environ['TEST_STATE'])
with (state / 'events').open('a') as log:
    log.write(json.dumps([name, args]) + '\n')

if name == 'id':
    print('serviceman' if args == ['-un'] else os.getuid())
elif name == 'uname':
    print('Linux' if args == ['-s'] else 'x86_64')
elif name == 'flock':
    try:
        fcntl.flock(int(args[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(1)
elif name == 'loginctl':
    print('no' if os.environ.get('NO_LINGER') else 'yes')
elif name == 'systemctl':
    if 'start' in args:
        (state / 'docker-started').touch()
    if os.environ.get('NO_PERSISTENCE') and 'is-enabled' in args:
        sys.exit(1)
elif name == 'docker':
    if args[:2] == ['context', 'show']:
        print('service-user')
    elif args[:2] == ['context', 'inspect']:
        print(f'unix:///run/user/{os.getuid()}/docker.sock')
    elif args[0] == 'info':
        if os.environ.get('DOCKER_STOPPED') and not (state / 'docker-started').exists():
            sys.exit(1)
        if '{{.Architecture}}' in args:
            print('x86_64')
        elif '{{json .SecurityOptions}}' in args:
            print('["name=rootless"]')
    elif args[0] == 'pull':
        if os.environ.get('DENY_REGISTRY'):
            sys.exit(1)
    elif args[:2] == ['image', 'inspect']:
        if '{{.Id}}' in args:
            if args[2].endswith(':main'):
                print((state / 'channel').read_text() if (state / 'channel').exists()
                      else 'sha256:' + os.environ.get('CHANNEL_DIGEST', '1') * 64)
            else:
                print('sha256:' + args[2].split('sha256:')[-1])
        else:
            print('b' * 40 if os.environ.get('WRONG_COMMIT') else 'a' * 40)
    elif args[0] == 'tag':
        (state / 'channel').write_text(args[1])
    elif args[0] == 'ps':
        if 'label=com.docker.compose.service=watchtower' in args:
            if (state / 'watchtower').exists(): print('existing-watchtower')
        elif (state / 'active').exists():
            print('running-lumi')
    elif args[0] == 'inspect':
        image = (state / 'active-image').read_text()
        enabled = (state / 'active-auto').read_text()
        print(image + ' ' + enabled)
    elif args[0] == 'stop':
        (state / 'watchtower').unlink(missing_ok=True)
    elif args[0] == 'start':
        (state / 'watchtower').touch()
    elif args[0] == 'create':
        print('unstarted-extraction-container')
    elif args[0] == 'cp':
        if os.environ.get('FAIL_COPY'):
            sys.exit(42)
        shutil.copytree(os.environ['TEST_BUNDLE'], args[2], dirs_exist_ok=True)
    elif args[0] == 'rm':
        pass
    elif args[0] == 'compose':
        if args[1] == 'version':
            print('Docker Compose version v2.39.0')
        elif args[1:3] == ['up', '--help']:
            print('--wait --wait-timeout')
        elif 'config' in args:
            directory = Path(args[args.index('--project-directory') + 1])
            model = {
                'name': 'lumi',
                'services': {
                    'lumi': {'image': os.environ['LUMI_IMAGE'],
                             'ports': [{'host_ip': '127.0.0.1', 'target': 8080, 'published': '18080'}],
                             'environment': {'PUBLIC_ORIGIN': 'https://lumi.test', 'SECRET': 'PRIVATE_TEST_SECRET'}},
                    'keycloak': {'ports': [{'host_ip': '127.0.0.1', 'target': 8080, 'published': '19090'}]},
                    'keycloak-db': {},
                },
                'volumes': {name: {'name': 'lumi_' + name} for name in ('lumi-data', 'keycloak-db')},
            }
            if '  gateway:' in (directory / 'compose.prod.yaml').read_text():
                model['services']['gateway'] = {
                    'ports': [{'host_ip': '127.0.0.1', 'target': 8080, 'published': '18081'}],
                    'volumes': [{'type': 'bind', 'source': str(directory / 'deploy/Caddyfile.prod'),
                                 'target': '/etc/caddy/Caddyfile', 'read_only': True}],
                    'healthcheck': {'test': ['CMD', 'wget', 'http://127.0.0.1:8081/healthz']},
                }
                gateway = model['services']['gateway']
                if os.environ.get('INVALID_GATEWAY_BIND'):
                    gateway['ports'][0]['host_ip'] = '0.0.0.0'
                if os.environ.get('INVALID_GATEWAY_MOUNT'):
                    gateway['volumes'][0]['source'] = '/another-release/Caddyfile'
                if os.environ.get('INVALID_GATEWAY_HEALTH'):
                    gateway.pop('healthcheck')
                if os.environ.get('DUPLICATE_GATEWAY_PORT'):
                    gateway['ports'][0]['published'] = '18080'
            if os.environ.get('INVALID_CONFIG'):
                model['services']['lumi']['build'] = '.'
            if str(directory / 'compose.watchtower.yaml') in args:
                label = 'com.centurylinklabs.watchtower.'
                model['services']['lumi']['labels'] = {label + 'enable': 'true', label + 'scope': 'lumi-app'}
                model['services']['watchtower'] = {
                    'image': 'ghcr.io/nicholas-fedor/watchtower:1.23.2@sha256:62fb91130ddb493f869cad7e198fa260dd16c5da293ed092cbd5d8781566f7a6',
                    'profiles': ['watchtower'],
                    'environment': {'WATCHTOWER_POLL_INTERVAL': '300', 'WATCHTOWER_LABEL_ENABLE': 'true',
                                    'WATCHTOWER_SCOPE': 'lumi-app', 'WATCHTOWER_USE_COMPOSE_DEPENDS_ON': 'false',
                                    'WATCHTOWER_ROLLING_RESTART': 'true', 'DOCKER_CONFIG': '/registry'},
                    'volumes': [{'type': 'bind', 'source': os.environ['LUMI_DOCKER_SOCKET'], 'target': '/var/run/docker.sock'},
                                {'type': 'bind', 'source': os.environ['LUMI_WATCHTOWER_CONFIG'], 'target': '/registry', 'read_only': True}],
                }
                if os.environ.get('INVALID_WATCHTOWER_SCOPE'):
                    model['services']['keycloak']['labels'] = {label + 'enable': 'true'}
            print(json.dumps(model))
        elif 'up' in args:
            if args[-1] == 'watchtower':
                if os.environ.get('FAIL_WATCHTOWER_START'): sys.exit(18)
                (state / 'watchtower').touch()
                sys.exit(0)
            directory = Path(args[args.index('--project-directory') + 1])
            release = json.loads((directory / 'release.json').read_text())['release_id']
            (state / 'active').write_text(release)
            selected = os.environ['LUMI_IMAGE']
            if selected.endswith(':main'):
                selected = (state / 'channel').read_text() if (state / 'channel').exists() else 'sha256:' + os.environ.get('CHANNEL_DIGEST', '1') * 64
            (state / 'active-image').write_text('sha256:' + selected.split('sha256:')[-1])
            (state / 'active-auto').write_text('true' if str(directory / 'compose.watchtower.yaml') in args else 'false')
            if os.environ.get('FAIL_UP') == release or os.environ.get('FAIL_UP_ALL'):
                sys.exit(17)
        elif 'stop' in args and args[-1] == 'watchtower':
            (state / 'watchtower').unlink(missing_ok=True)
    else:
        sys.exit('Unexpected docker command')
elif name == 'curl':
    url = args[-1]
    active = (state / 'active').read_text() if (state / 'active').exists() else ''
    if os.environ.get('FAIL_HEALTH') == active:
        sys.exit(22)
    if url.startswith('http://127.0.0.1:18081/') and os.environ.get('FAIL_GATEWAY') == active:
        sys.exit(22)
    if url.endswith('/keycloak/realms/lumi/.well-known/openid-configuration'):
        print(json.dumps({'issuer': 'https://lumi.test/keycloak/realms/lumi'}))
    elif url.endswith('/api/v1/session'):
        print('401')
    elif url.endswith('/auth/login'):
        print('HTTP/2 302\r\nLocation: https://lumi.test/keycloak/realms/lumi/protocol/openid-connect/auth?client_id=lumi\r\n')
    elif url == 'http://127.0.0.1:18080/healthz':
        print('{"status":"ok"}')
    else:
        print('404')
elif name == 'machinectl':
    assert args[:4] == ['shell', 'serviceman@.host', '/bin/bash', '-lc']
    # Preserve the test PATH; a real login shell initializes serviceman's PATH.
    subprocess.run(['/bin/bash', '-c', args[4]], check=False)
    # Reproduce machinectl's lack of child exit status propagation.
    sys.exit(0)
else:
    sys.exit('Unexpected test tool: ' + name)
