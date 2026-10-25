#!/usr/bin/env python3
"""Opt-in real Docker smoke test using disposable, independently named resources."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def command(*args, capture=False, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=capture, **kwargs)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def status(url):
    try:
        with urllib.request.build_opener(NoRedirect).open(url, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', help='Use a prebuilt image; native images can exercise Compose without emulation')
    args = parser.parse_args()
    project = 'lumi-deploy-test-' + secrets.token_hex(6)
    image = args.image or project + ':local'
    if not args.image:
        command('docker', 'build', '--platform', 'linux/amd64', '-t', image, str(ROOT))
    inspect = json.loads(command('docker', 'image', 'inspect', image, capture=True).stdout)[0]
    assert inspect['Os'] == 'linux'
    if not args.image:
        assert inspect['Architecture'] == 'amd64', 'Use the production amd64 platform'
    platform = 'linux/' + inspect['Architecture']
    image_id = inspect['Id']
    with tempfile.TemporaryDirectory(prefix=project + '-') as temporary:
        directory = Path(temporary)
        container = command('docker', 'create', '--platform', platform, '--entrypoint', '/bin/true', image_id, capture=True).stdout.strip()
        try:
            command('docker', 'cp', container + ':/opt/lumi-deploy/.', str(directory))
            assert command('docker', 'inspect', '--format', '{{.State.Status}}', container, capture=True).stdout.strip() == 'created'
        finally:
            command('docker', 'rm', container)
        expected = ['compose.yaml', 'compose.prod.yaml', '.env.example']
        expected += [str(p.relative_to(ROOT)) for p in (ROOT / 'deploy/keycloak').rglob('*') if p.is_file()]
        actual = sorted(str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file())
        assert actual == sorted(expected), 'Unexpected deployment bundle contents (including private files)'
        for name in expected:
            assert (directory / name).read_bytes() == (ROOT / name).read_bytes(), 'Image bundle differs: ' + name
        app_port, admin_port, gateway_port = free_port(), free_port(), free_port()
        origin = f'http://127.0.0.1:{gateway_port}'
        config = directory / 'test.env'
        config.write_text('\n'.join([
            f'PUBLIC_ORIGIN={origin}', f'LUMI_PORT={app_port}', f'KEYCLOAK_ADMIN_PORT={admin_port}',
            f'KEYCLOAK_ADMIN_ORIGIN=http://localhost:{admin_port}', 'KEYCLOAK_ADMIN_USER=admin',
            'KEYCLOAK_ADMIN_PASSWORD=' + secrets.token_hex(24), 'KEYCLOAK_DB_PASSWORD=' + secrets.token_hex(24),
            'OIDC_CLIENT_SECRET=' + secrets.token_hex(24), 'SMTP_ENABLED=false', 'SMTP_HOST=', 'SMTP_FROM=',
            'SMTP_AUTH=false', 'SMTP_STARTTLS=false', 'SMTP_SSL=false',
            # Exercise broker create/update before the master issuer changes.
            # These disposable values are never used to contact Google.
            'GOOGLE_CLIENT_ID=smoke-test-client', 'GOOGLE_CLIENT_SECRET=' + secrets.token_hex(24), '',
        ]))
        config.chmod(0o600)
        def set_email(enabled):
            values = {'SMTP_ENABLED': 'true' if enabled else 'false',
                      'SMTP_HOST': 'unused.test' if enabled else '',
                      'SMTP_FROM': 'smoke@unused.test' if enabled else '',
                      'SMTP_PASSWORD': '\'test-only-"quoted"\\password$\'' if enabled else ''}
            lines = [line for line in config.read_text().splitlines() if line.split('=', 1)[0] not in values]
            config.write_text('\n'.join(lines + [key + '=' + value for key, value in values.items()]) + '\n')

        def verify_email(enabled):
            # Read back Keycloak's effective realm, without printing credentials.
            values = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line)
            base = f'http://localhost:{admin_port}/keycloak'
            form = urllib.parse.urlencode({'grant_type': 'password', 'client_id': 'admin-cli',
                                          'username': values['KEYCLOAK_ADMIN_USER'],
                                          'password': values['KEYCLOAK_ADMIN_PASSWORD']}).encode()
            with urllib.request.urlopen(base + '/realms/master/protocol/openid-connect/token', data=form, timeout=15) as response:
                token = json.load(response)['access_token']
            request = urllib.request.Request(base + '/admin/realms/lumi', headers={'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(request, timeout=15) as response:
                realm = json.load(response)
            assert realm['registrationAllowed'] is enabled
            assert realm['resetPasswordAllowed'] is enabled
            assert realm['verifyEmail'] is True
            if enabled:
                assert realm['smtpServer']['host'] == 'unused.test'
                assert realm['smtpServer']['from'] == 'smoke@unused.test'
            else:
                assert not realm.get('smtpServer')
        (directory / 'Caddyfile').write_text(''':80 {
    @keycloak path /keycloak/realms/lumi/* /keycloak/resources/*
    handle @keycloak {
        reverse_proxy keycloak:8080
    }
    handle /keycloak* {
        respond 404
    }
    handle /healthz {
        respond 404
    }
    handle {
        reverse_proxy lumi:8080
    }
}
''')
        override = directory / 'test.yaml'
        override.write_text(f'''services:
  lumi:
    platform: {platform}
    healthcheck:
      interval: 2s
  gateway:
    image: caddy:2@sha256:504a44d7d74bd2bc28a66afc4774912fc21223ca8a67734af1c54ab2f999b489
    ports: ["127.0.0.1:{gateway_port}:80"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
''')
        compose = ['docker', 'compose', '-p', project, '--env-file', str(config),
                   '-f', str(directory / 'compose.yaml'), '-f', str(directory / 'compose.prod.yaml'), '-f', str(override)]
        config_keys = {line.split('=', 1)[0] for line in (ROOT / '.env.example').read_text().splitlines() if '=' in line and not line.startswith('#')}
        env = {k: v for k, v in os.environ.items() if k not in config_keys | {'NATIVE_ORIGIN'}}
        env['LUMI_IMAGE'] = image_id
        model = json.loads(command(*compose, 'config', '--format', 'json', env=env, capture=True).stdout)
        assert model['services']['lumi']['image'] == image_id
        assert all('build' not in service for service in model['services'].values())
        assert all(v['name'].startswith(project + '_') for v in model['volumes'].values())
        try:
            for service in ('keycloak-db', 'keycloak', 'gateway'):
                command('docker', 'pull', model['services'][service]['image'])
            command(*compose, 'up', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '360', env=env)
            verify_email(False)
            app_container = command(*compose, 'ps', '-q', 'lumi', env=env, capture=True).stdout.strip()
            assert command('docker', 'inspect', '--format', '{{.Image}}', app_container, capture=True).stdout.strip() == image_id
            assert status(f'http://127.0.0.1:{app_port}/healthz')[0] == 200
            assert status(origin + '/api/v1/session')[0] == 401
            assert status(origin + '/api/v1/admin/connection')[0] == 401
            assert status(origin + '/auth/login')[0] == 303
            for endpoint in (origin, f'http://127.0.0.1:{admin_port}'):
                code, body = status(endpoint + '/keycloak/realms/lumi/.well-known/openid-configuration')
                assert code == 200 and json.loads(body)['issuer'] == origin + '/keycloak/realms/lumi'
            command(*compose, 'exec', '-T', 'lumi', 'sh', '-ec', 'test -f /data/chatgpt.json && test -f /data/lumi.db', env=env)
            for path in ('/healthz', '/keycloak/admin/', '/keycloak/realms/master/.well-known/openid-configuration'):
                assert status(origin + path)[0] == 404
            # A second release has matching files at new bind-mount paths but
            # must reuse the server configuration and named data volumes.
            next_release = directory / 'next-release'
            for name in expected + ['Caddyfile', 'test.yaml']:
                target = next_release / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(directory / name, target)
            next_compose = ['docker', 'compose', '-p', project, '--env-file', str(config),
                            '-f', str(next_release / 'compose.yaml'), '-f', str(next_release / 'compose.prod.yaml'),
                            '-f', str(next_release / 'test.yaml')]
            next_model = json.loads(command(*next_compose, 'config', '--format', 'json', env=env, capture=True).stdout)
            assert next_model['volumes'] == model['volumes']
            command(*compose, 'exec', '-T', 'lumi', 'sh', '-ec', 'printf retained > /data/.deployment-smoke', env=env)
            volumes_before = command('docker', 'volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project, capture=True).stdout
            set_email(True)
            command(*next_compose, 'up', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '360', env=env)
            verify_email(True)
            set_email(False)
            command(*next_compose, 'up', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '360', env=env)
            verify_email(False)
            assert command('docker', 'volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project, capture=True).stdout == volumes_before
            command(*next_compose, 'exec', '-T', 'lumi', 'sh', '-ec', 'test "$(cat /data/.deployment-smoke)" = retained', env=env)
            assert status(f'http://127.0.0.1:{app_port}/healthz')[0] == 200
            print('Isolated extraction, Compose activation, authentication gate, SMTP off/on/off, and volume persistence passed.')
        except subprocess.CalledProcessError:
            # Initialization diagnostics contain only this disposable test's
            # configuration; never render or log the resolved Compose model.
            subprocess.run([*compose, 'logs', '--no-color', '--tail', '80', 'keycloak-db', 'keycloak', 'keycloak-init'], env=env, check=False)
            raise
        finally:
            # Only this randomly named disposable project's resources are removed.
            command(*compose, 'down', '--volumes', env=env)


if __name__ == '__main__':
    main()
