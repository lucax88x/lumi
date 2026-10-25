import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('deploy', ROOT / 'scripts/deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def release(run_id=101, attempt=1, digest='1'):
    return dict(schema=1, repository='lucax88x/lumi', release_id=f'{run_id}-{attempt}',
                run_id=run_id, run_attempt=attempt, commit='a' * 40,
                digest='sha256:' + digest * 64, image=deploy.IMAGE + '@sha256:' + digest * 64)


def run(run_id=101, **kwargs):
    return dict(id=run_id, run_attempt=1, workflow_id=7, path='.github/workflows/publish.yml',
                head_branch='main', event='push', status='completed', conclusion='success',
                repository={'full_name': 'lucax88x/lumi'}, head_repository={'full_name': 'lucax88x/lumi'},
                head_sha='a' * 40, created_at=f'2026-10-{run_id - 90:02d}T00:00:00Z') | kwargs


class FakeGitHub:
    def __init__(self, runs=None, metadata=None, artifact_attempt=1):
        self.runs = runs or [run()]
        self.metadata = metadata or release()
        self.artifact_attempt = artifact_attempt
        self.paths = []

    def api(self, path, binary=False):
        self.paths.append(path)
        if path == 'actions/workflows/publish.yml':
            return {'id': 7}
        if '/runs?' in path:
            return {'workflow_runs': self.runs}
        if path.endswith('/zip'):
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w') as archive:
                archive.writestr('release.json', json.dumps(self.metadata))
            return output.getvalue()
        if '/artifacts?' in path:
            return {'artifacts': [dict(id=123, expired=False, name=f'lumi-release-{self.metadata["run_id"]}-{self.artifact_attempt}')]}
        return next(r for r in self.runs if path == f'actions/runs/{r["id"]}')


class PublicationTests(unittest.TestCase):
    def test_latest_successful_main_publication(self):
        api = FakeGitHub([run(100), run(), run(102, conclusion='failure'), run(103, head_branch='feature')])
        self.assertEqual(deploy.resolve_release(api), release())

    def test_explicit_older_run(self):
        api = FakeGitHub([run(100), run()], metadata=release(100))
        self.assertEqual(deploy.resolve_release(api, '100'), release(100))

    def test_github_workflow_path_can_include_main_ref(self):
        for suffix in ('@main', '@refs/heads/main'):
            with self.subTest(suffix=suffix):
                api = FakeGitHub([run(path='.github/workflows/publish.yml' + suffix)])
                self.assertEqual(deploy.resolve_release(api), release())

    def test_rejects_untrusted_run(self):
        for bad in [run(conclusion='failure'), run(status='in_progress'), run(head_branch='feature'),
                    run(event='pull_request'), run(workflow_id=6), run(path='other.yml'),
                    run(path='.github/workflows/publish.yml@feature'),
                    run(head_repository={'full_name': 'stranger/lumi'})]:
            with self.subTest(bad=bad), self.assertRaises(deploy.DeployError):
                deploy.resolve_release(FakeGitHub([bad]), '101')

    def test_rejects_stale_attempt_artifact(self):
        with self.assertRaises(deploy.DeployError):
            deploy.resolve_release(FakeGitHub([run(run_attempt=2)]))

    def test_rejects_digest_or_metadata_mismatch(self):
        for key, value in [('digest', 'sha256:bad'), ('digest', 'sha256:' + 'A' * 64),
                           ('image', 'attacker/lumi@sha256:' + '1' * 64), ('commit', 'b' * 40),
                           ('release_id', '../oops'), ('run_attempt', 2)]:
            with self.subTest(key=key), self.assertRaises(deploy.DeployError):
                deploy.validate_release(release() | {key: value}, run())

    def test_secret_fields_are_not_forwarded(self):
        self.assertEqual(deploy.validate_release(release() | {'token': 'PRIVATE_TEST_SECRET'}, run()), release())

    @patch.dict(os.environ, {'GH_TOKEN': 'work-token', 'GITHUB_TOKEN': 'other-token', 'GH_HOST': 'work.example'})
    @patch.object(deploy.subprocess, 'run')
    def test_personal_account_without_global_switch(self, process):
        process.return_value = subprocess.CompletedProcess([], 0, b'personal-token\n', b'')
        github = deploy.GitHub()
        self.assertEqual(github.env['GH_TOKEN'], 'personal-token')
        self.assertNotIn('GITHUB_TOKEN', github.env)
        self.assertNotIn('GH_TOKEN', process.call_args.kwargs['env'])
        self.assertIn('lucax88x', process.call_args.args[0])
        self.assertEqual(os.environ['GH_TOKEN'], 'work-token')


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lumi test ' $ ")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.root = self.home / 'lumi'
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.state = self.home / 'state'
        self.state.mkdir()
        tool = self.bin / 'tool'
        tool.write_text('#!' + shutil.which('python3') + '\n' + (ROOT / 'scripts/tests/fake_deploy_tool.py').read_text())
        tool.chmod(0o700)
        for name in ('id', 'uname', 'flock', 'docker', 'systemctl', 'loginctl', 'curl', 'machinectl'):
            (self.bin / name).symlink_to(tool)
        self.bundle = self.home / 'bundle'
        self.bundle.mkdir()
        for file in ('compose.yaml', 'compose.prod.yaml', '.env.example'):
            shutil.copyfile(ROOT / file, self.bundle / file)
        shutil.copytree(ROOT / 'deploy/keycloak', self.bundle / 'deploy/keycloak')
        shutil.copyfile(ROOT / 'deploy/Caddyfile.prod', self.bundle / 'deploy/Caddyfile.prod')
        self.env = os.environ | dict(HOME=str(self.home), PATH=str(self.bin) + ':' + os.environ['PATH'],
                                     TEST_STATE=str(self.state), TEST_BUNDLE=str(self.bundle))
        for key in ('DOCKER_CONTEXT', 'DOCKER_HOST'):
            self.env.pop(key, None)

    def invoke(self, action, data='', **env):
        return subprocess.run(['/bin/bash', str(ROOT / 'scripts/deploy-remote.sh'), action,
                               json.dumps(data, separators=(',', ':')) if isinstance(data, dict) else data],
                              env=self.env | env, capture_output=True, text=True, timeout=30)

    def setup(self):
        result = self.invoke('setup')
        self.assertEqual(result.returncode, 0, result.stderr)
        (self.root / 'config/.env').write_text('PRIVATE_TEST_SECRET=local-only\n')

    def seed(self, metadata):
        directory = self.root / 'releases' / metadata['release_id']
        shutil.copytree(self.bundle, directory)
        (directory / 'release.json').write_text(json.dumps(metadata, separators=(',', ':')) + '\n')
        return directory

    def events(self):
        return [json.loads(line) for line in (self.state / 'events').read_text().splitlines()]

    def assertNoActivation(self):
        self.assertFalse((self.state / 'active').exists())
        self.assertFalse((self.root / 'current').exists())

    def test_setup_private_idempotent_and_can_start_existing_user_service(self):
        result = self.invoke('setup', DOCKER_STOPPED='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        for directory in ('', 'config', 'releases'):
            self.assertEqual((self.root / directory).stat().st_mode & 0o777, 0o700)
        config = self.root / 'config/.env'
        self.assertEqual(config.read_text(), (ROOT / '.env.example').read_text())
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        config.write_text('keep-existing-secret\n')
        self.assertEqual(self.invoke('setup').returncode, 0)
        self.assertEqual(config.read_text(), 'keep-existing-secret\n')
        starts = [args for name, args in self.events() if name == 'systemctl' and 'start' in args]
        self.assertEqual(starts, [['--user', 'start', 'docker.service']])

    def test_missing_daemon_persistence_fails(self):
        self.assertNotEqual(self.invoke('setup', NO_LINGER='1').returncode, 0)
        self.assertNotEqual(self.invoke('setup', NO_PERSISTENCE='1').returncode, 0)

    def test_check_extracts_matching_bundle_without_activation(self):
        self.setup()
        result = self.invoke('check', release())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNoActivation()
        self.assertFalse(list((self.root / 'releases').iterdir()))
        self.assertFalse(list(self.root.glob('.compose.*')))
        self.assertNotIn('PRIVATE_TEST_SECRET', result.stdout + result.stderr)
        self.assertTrue(any(name == 'docker' and args[0] == 'create' for name, args in self.events()))
        self.assertFalse(any(name == 'docker' and args[0] == 'start' for name, args in self.events()))

    def test_deploy_and_explicit_rollback_preserve_volumes_and_configuration(self):
        self.setup()
        first = self.invoke('deploy', release(100, digest='2'))
        self.assertEqual(first.returncode, 0, first.stderr)
        result = self.invoke('deploy', release())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(os.readlink(self.root / 'current'), 'releases/101-1')
        self.assertEqual(os.readlink(self.root / 'previous'), 'releases/100-1')
        rollback = self.invoke('rollback', '100-1')
        self.assertEqual(rollback.returncode, 0, rollback.stderr)
        self.assertEqual(os.readlink(self.root / 'current'), 'releases/100-1')
        self.assertEqual(os.readlink(self.root / 'previous'), 'releases/101-1')
        self.assertEqual((self.root / 'config/.env').read_text(), 'PRIVATE_TEST_SECRET=local-only\n')
        for name, args in self.events():
            if name == 'docker':
                self.assertNotIn('down', args)
                self.assertNotIn('prune', args)
                if 'up' in args and '--help' not in args:
                    for flag in ('--no-build', '--wait', '--pull', 'never'):
                        self.assertIn(flag, args)
                    self.assertIn('lumi', args)

    def test_failed_activation_and_health_restore_preceding_release(self):
        for failure in ('FAIL_UP', 'FAIL_HEALTH', 'FAIL_GATEWAY'):
            with self.subTest(failure=failure):
                self.setup()
                self.assertEqual(self.invoke('deploy', release(100, digest='2')).returncode, 0)
                result = self.invoke('deploy', release(), **{failure: '101-1'})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Preceding release restored', result.stderr)
                self.assertEqual((self.state / 'active').read_text(), '100-1')
                self.assertEqual(os.readlink(self.root / 'current'), 'releases/100-1')
                self.assertTrue((self.root / 'releases/101-1').exists())

    def test_gateway_requires_private_binding_matching_bundle_and_healthcheck(self):
        self.setup()
        for key in ('INVALID_GATEWAY_BIND', 'INVALID_GATEWAY_MOUNT', 'INVALID_GATEWAY_HEALTH', 'DUPLICATE_GATEWAY_PORT'):
            with self.subTest(key=key):
                result = self.invoke('check', release(), **{key: '1'})
                self.assertNotEqual(result.returncode, 0)
                self.assertNoActivation()
                self.assertNotIn('PRIVATE_TEST_SECRET', result.stdout + result.stderr)
        (self.bundle / 'deploy/Caddyfile.prod').unlink()
        result = self.invoke('check', release())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing bundled production Caddyfile', result.stderr)
        self.assertNoActivation()

    def test_gateway_routes_are_checked_before_current_is_promoted(self):
        self.setup()
        result = self.invoke('deploy', release())
        self.assertEqual(result.returncode, 0, result.stderr)
        urls = [args[-1] for name, args in self.events() if name == 'curl']
        for path in ('/api/v1/session', '/auth/login', '/keycloak/realms/lumi/.well-known/openid-configuration',
                     '/healthz', '/keycloak/admin/', '/keycloak/realms/master/.well-known/openid-configuration'):
            self.assertIn('http://127.0.0.1:18081' + path, urls)

    def test_legacy_rollback_stops_gateway_and_uses_original_health_checks(self):
        self.setup()
        legacy = self.seed(release(100, digest='2'))
        file = legacy / 'compose.prod.yaml'
        file.write_text('services:\n  lumi:' + file.read_text().split('\n  lumi:', 1)[1])
        (legacy / 'deploy/Caddyfile.prod').unlink()
        result = self.invoke('deploy', release())
        self.assertEqual(result.returncode, 0, result.stderr)
        count = len(self.events())
        result = self.invoke('rollback', '100-1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('original direct routing', result.stderr)
        events = self.events()[count:]
        self.assertTrue(any(name == 'docker' and args[-2:] == ['stop', 'gateway'] for name, args in events))
        self.assertFalse(any(name == 'curl' and args[-1].startswith('http://127.0.0.1:18081') for name, args in events))

    def test_first_failure_reports_no_preceding_release(self):
        self.setup()
        result = self.invoke('deploy', release(), FAIL_UP='101-1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no preceding release', result.stderr)
        self.assertFalse((self.root / 'current').exists())

    def test_failed_extraction_removes_only_its_temporary_container_and_directory(self):
        self.setup()
        result = self.invoke('deploy', release(), FAIL_COPY='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNoActivation()
        self.assertFalse(list((self.root / 'releases').iterdir()))
        removals = [args for name, args in self.events() if name == 'docker' and args[0] == 'rm']
        self.assertEqual(removals, [['rm', 'unstarted-extraction-container']])

    def test_failed_restoration_is_reported_without_changing_current(self):
        self.setup()
        self.seed(release(100, digest='2'))
        (self.root / 'current').symlink_to('releases/100-1')
        result = self.invoke('deploy', release(), FAIL_UP_ALL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('RESTORATION FAILED', result.stderr)
        self.assertEqual(os.readlink(self.root / 'current'), 'releases/100-1')
        self.assertTrue((self.root / 'releases/101-1').exists())
        self.assertFalse(list(self.root.glob('.compose.*')))
        self.assertFalse(list(self.root.glob('.*.next-*')))

    def test_registry_denial_wrong_image_and_invalid_config_do_not_activate(self):
        self.setup()
        for key in ('DENY_REGISTRY', 'WRONG_COMMIT', 'INVALID_CONFIG'):
            with self.subTest(key=key):
                result = self.invoke('deploy', release(), **{key: '1'})
                self.assertNotEqual(result.returncode, 0)
                self.assertNoActivation()
                self.assertNotIn('PRIVATE_TEST_SECRET', result.stdout + result.stderr)
        self.assertFalse(list(self.root.glob('.compose.*')))

    def test_invalid_metadata_is_rejected_even_with_python_optimization(self):
        self.setup()
        result = self.invoke('deploy', release() | {'release_id': '../escape'}, PYTHONOPTIMIZE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNoActivation()
        self.assertFalse(any(name == 'docker' and args[0] == 'pull' for name, args in self.events()))

    def test_missing_config_and_concurrent_deployment(self):
        self.setup()
        (self.root / 'config/.env').unlink()
        self.assertNotEqual(self.invoke('deploy', release()).returncode, 0)
        self.assertNoActivation()
        (self.root / 'config/.env').write_text('')
        with (self.root / '.deployment.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.invoke('deploy', release())
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Another deployment', result.stderr)
            self.assertNoActivation()

    def test_release_cannot_be_overwritten(self):
        self.setup()
        self.seed(release(digest='2'))
        result = self.invoke('deploy', release())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('differs', result.stderr)
        self.assertNoActivation()

    def test_wrapper_quotes_shell_input_and_reports_child_status(self):
        marker = 'LUMI_TEST_COMPLETE'
        argument = "spaces ' quotes ; $(touch INJECTION) `touch INJECTION2`"
        with patch.object(deploy.Path, 'read_bytes', return_value=b'printf "%s\\n" "$2"; exit 37'):
            command = deploy.remote_command('check', argument, marker)
        result = subprocess.run(shlex.split(command), env=self.env, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)  # machinectl masks the child status
        self.assertIn(argument.encode(), result.stdout)
        self.assertIn((marker + ':37').encode(), result.stdout)
        with self.assertRaisesRegex(deploy.DeployError, 'status 37'):
            deploy.completion_status(result.stdout, marker, result.returncode)
        self.assertFalse((ROOT / 'INJECTION').exists())
        self.assertFalse((ROOT / 'INJECTION2').exists())

    def test_completion_rejects_cancel_disconnect_and_missing_marker(self):
        marker = 'LUMI_TEST_COMPLETE'
        for output, status in [(b'polkit cancelled\r\n', 0), (b'', 255),
                               (b'LUMI_TEST_COMPLETE:0\r\n', 255),
                               (b'LUMI_TEST_COMPLETE:0\nLUMI_TEST_COMPLETE:0\n', 0)]:
            with self.subTest(output=output), self.assertRaises(deploy.DeployError):
                deploy.completion_status(output, marker, status)
        deploy.completion_status(b'prompt\r\nLUMI_TEST_COMPLETE:0\r\n', marker, 0)


if __name__ == '__main__':
    unittest.main()
