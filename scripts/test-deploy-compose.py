#!/usr/bin/env python3
"""Opt-in real Docker smoke test using disposable, independently named resources."""
import argparse
import html.parser
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
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


class LoginForm(html.parser.HTMLParser):
    action = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'form' and attrs.get('id') == 'kc-form-login':
            self.action = attrs.get('action')


def status(url, context=None):
    try:
        with urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=context)).open(url, timeout=15) as response:
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
        expected = ['compose.yaml', 'compose.prod.yaml', '.env.example', 'deploy/Caddyfile.prod']
        expected += [str(p.relative_to(ROOT)) for p in (ROOT / 'deploy/keycloak').rglob('*') if p.is_file()]
        actual = sorted(str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file())
        assert actual == sorted(expected), 'Unexpected deployment bundle contents (including private files)'
        for name in expected:
            assert (directory / name).read_bytes() == (ROOT / name).read_bytes(), 'Image bundle differs: ' + name
        app_port, admin_port, gateway_port, public_port = [free_port() for _ in range(4)]
        origin = f'https://127.0.0.1:{public_port}'
        gateway = f'http://127.0.0.1:{gateway_port}'
        outer = directory / 'test-outer'
        outer.mkdir()
        command('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
                '-keyout', str(outer / 'tls.key'), '-out', str(outer / 'tls.crt'), capture=True)
        tls = ssl.create_default_context(cafile=str(outer / 'tls.crt'))
        probe = directory / 'gateway-probe'
        command('mise', 'exec', '--', 'go', 'build', '-o', str(probe), str(ROOT / 'scripts/tests/testdata/gateway-probe.go'),
                env=os.environ | {'CGO_ENABLED': '0', 'GOOS': 'linux', 'GOARCH': inspect['Architecture']})
        config = directory / 'test.env'
        config.write_text('\n'.join([
            f'PUBLIC_ORIGIN={origin}', f'LUMI_PORT={app_port}', f'LUMI_GATEWAY_PORT={gateway_port}', f'KEYCLOAK_ADMIN_PORT={admin_port}',
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

        def keycloak_admin(method, path, body=None):
            # This disposable stack's administrator credentials never leave memory.
            values = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line)
            base = f'http://localhost:{admin_port}/keycloak'
            form = urllib.parse.urlencode({'grant_type': 'password', 'client_id': 'admin-cli',
                                          'username': values['KEYCLOAK_ADMIN_USER'],
                                          'password': values['KEYCLOAK_ADMIN_PASSWORD']}).encode()
            with urllib.request.urlopen(base + '/realms/master/protocol/openid-connect/token', data=form, timeout=15) as response:
                token = json.load(response)['access_token']
            request = urllib.request.Request(base + '/admin/realms/lumi' + path, method=method,
                                             data=None if body is None else json.dumps(body).encode(),
                                             headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=15) as response:
                content = response.read()
                return json.loads(content) if content else None

        def verify_email(enabled):
            realm = keycloak_admin('GET', '')
            assert realm['registrationAllowed'] is enabled
            assert realm['resetPasswordAllowed'] is enabled
            assert realm['verifyEmail'] is True
            if enabled:
                assert realm['smtpServer']['host'] == 'unused.test'
                assert realm['smtpServer']['from'] == 'smoke@unused.test'
            else:
                assert not realm.get('smtpServer')

        def verify_frontend():
            # Complete a real OIDC login, then fetch React and its bundled assets.
            username = 'gateway-smoke@example.test'
            password = secrets.token_urlsafe(24)
            keycloak_admin('POST', '/users', {'username': username, 'email': username, 'enabled': True,
                                             'emailVerified': True, 'firstName': 'Gateway', 'lastName': 'Smoke',
                                             'credentials': [{'type': 'password', 'value': password, 'temporary': False}]})
            users = keycloak_admin('GET', '/users?username=' + urllib.parse.quote(username))
            assert len(users) == 1
            role = keycloak_admin('GET', '/roles/portal-access')
            keycloak_admin('POST', '/users/' + users[0]['id'] + '/role-mappings/realm', [role])
            cookies = http.cookiejar.CookieJar()
            client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies),
                                                  urllib.request.HTTPSHandler(context=tls))
            with client.open(origin + '/auth/login', timeout=20) as response:
                login_page = response.read().decode()
                page_url = response.url
                form = LoginForm()
                form.feed(login_page)
            resources = {urllib.parse.urljoin(page_url, resource)
                         for resource in re.findall(r'(?:src|href)="([^\"]+)"', login_page)
                         if urllib.parse.urlsplit(resource).path.startswith('/keycloak/resources/')}
            assert resources, 'Keycloak login resources are missing'
            for resource in resources:
                assert resource.startswith(origin + '/keycloak/resources/')
                with client.open(resource, timeout=15) as response:
                    assert response.status == 200 and response.read()
            assert form.action and form.action.startswith(origin + '/keycloak/realms/lumi/')
            data = urllib.parse.urlencode({'username': username, 'password': password}).encode()
            with client.open(form.action, data=data, timeout=20) as response:
                page = response.read().decode()
                assert response.status == 200 and response.url == origin + '/'
            assert any(c.name == 'lumi_session' and c.secure and c.has_nonstandard_attr('HttpOnly') for c in cookies)
            assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', page)
            assert assets, 'React build is missing'
            for asset in assets:
                with client.open(origin + asset, timeout=15) as response:
                    assert response.status == 200 and response.read()
        (outer / 'Caddyfile').write_text('''{
    admin off
    auto_https off
}
:443 {
    tls /etc/caddy/tls.crt /etc/caddy/tls.key
    reverse_proxy gateway:8080 {
        flush_interval -1
    }
}
''')
        override = directory / 'test.yaml'
        override.write_text(f'''services:
  lumi:
    platform: {platform}
    healthcheck:
      interval: 2s
  outer:
    image: caddy:2@sha256:504a44d7d74bd2bc28a66afc4774912fc21223ca8a67734af1c54ab2f999b489
    ports: ["127.0.0.1:{public_port}:443"]
    volumes: ["{outer}:/etc/caddy:ro"]
    depends_on:
      gateway:
        condition: service_healthy
''')
        compose = ['docker', 'compose', '-p', project, '--env-file', str(config),
                   '-f', str(directory / 'compose.yaml'), '-f', str(directory / 'compose.prod.yaml'), '-f', str(override)]
        config_keys = {line.split('=', 1)[0] for line in (ROOT / '.env.example').read_text().splitlines() if '=' in line and not line.startswith('#')}
        env = {k: v for k, v in os.environ.items() if k not in config_keys | {'NATIVE_ORIGIN'}}
        env['LUMI_IMAGE'] = image_id
        model = json.loads(command(*compose, 'config', '--format', 'json', env=env, capture=True).stdout)
        assert model['services']['lumi']['image'] == image_id
        ports = model['services']['gateway']['ports']
        assert len(ports) == 1 and ports[0]['host_ip'] == '127.0.0.1'
        assert ports[0]['target'] == 8080 and ports[0]['published'] == str(gateway_port)
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
            for endpoint in (origin, gateway):
                assert status(endpoint + '/api/v1/session', tls)[0] == 401
                assert status(endpoint + '/api/v1/admin/connection', tls)[0] == 401
                assert status(endpoint + '/auth/login', tls)[0] == 303
            for endpoint in (origin, gateway, f'http://127.0.0.1:{admin_port}'):
                code, body = status(endpoint + '/keycloak/realms/lumi/.well-known/openid-configuration', tls)
                assert code == 200 and json.loads(body)['issuer'] == origin + '/keycloak/realms/lumi'
            command(*compose, 'exec', '-T', 'lumi', 'sh', '-ec', 'test -f /data/chatgpt.json && test -f /data/lumi.db', env=env)
            for endpoint in (origin, gateway):
                for path in ('/healthz', '/keycloak', '/keycloak/admin/', '/keycloak/realms/master/.well-known/openid-configuration'):
                    assert status(endpoint + path, tls)[0] == 404
            verify_frontend()
            # A second release has matching files at new bind-mount paths but
            # must reuse the server configuration and named data volumes.
            next_release = directory / 'next-release'
            for name in expected + ['test.yaml']:
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
            # Replace only this disposable project's application with a tiny
            # upstream to measure headers and incremental delivery through both proxies.
            probe_override = directory / 'probe.yaml'
            probe_override.write_text(f'''services:
  lumi:
    entrypoint: [/opt/lumi-gateway-probe]
    command: []
    volumes: ["{probe}:/opt/lumi-gateway-probe:ro"]
''')
            probe_compose = [*next_compose, '-f', str(probe_override)]
            command(*probe_compose, 'up', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90', env=env)
            request = urllib.request.Request(origin + '/headers', headers={'X-Forwarded-Proto': 'http',
                                                                          'X-Forwarded-Host': 'attacker.invalid'})
            with urllib.request.urlopen(request, context=tls, timeout=15) as response:
                headers = json.load(response)
            assert headers == {'host': urllib.parse.urlsplit(origin).netloc,
                               'forwardedHost': urllib.parse.urlsplit(origin).netloc, 'proto': 'https'}, headers
            started = time.monotonic()
            with urllib.request.urlopen(origin + '/stream', context=tls, timeout=15) as response:
                assert response.readline() == b'data: first\n'
                assert time.monotonic() - started < 1.5, 'First event was buffered'
                assert b'data: second' in response.read()
            assert time.monotonic() - started >= 2, 'Streaming fixture did not wait'
            print('Isolated bundle, two-hop HTTPS routing, real login/React assets, streaming, SMTP off/on/off, and persistent volumes passed.')
        except Exception:
            # Initialization diagnostics contain only this disposable test's
            # configuration; never render or log the resolved Compose model.
            subprocess.run([*compose, 'logs', '--no-color', '--tail', '80', 'keycloak-db', 'keycloak', 'keycloak-init', 'gateway', 'outer'], env=env, check=False)
            raise
        finally:
            # Only this randomly named disposable project's resources are removed.
            command(*compose, 'down', '--volumes', env=env)


if __name__ == '__main__':
    main()
