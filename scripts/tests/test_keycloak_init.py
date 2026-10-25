import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class KeycloakEmailTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="lumi keycloak ' ")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.state = self.directory / 'state.json'
        self.state.write_text(json.dumps({'realm': {'smtpServer': {'host': 'old.test', 'password': 'old-test-secret'},
                                                       'registrationAllowed': True, 'resetPasswordAllowed': True,
                                                       'verifyEmail': True}, 'calls': []}))
        fake = self.directory / 'kcadm'
        fake.write_text('#!' + shutil.which('python3') + '\n' + '''
import json, os, pathlib, sys
path = pathlib.Path(os.environ['TEST_KEYCLOAK_STATE'])
state = json.loads(path.read_text()); args = sys.argv[1:]
state['calls'].append(args)
if args[:2] == ['config', 'credentials']:
    state['issuerChanged'] = False
elif state.get('issuerChanged'):
    sys.exit('HTTP 401 Unauthorized: issuer changed before remaining admin calls')
elif args[:2] == ['update', 'realms/lumi']:
    for i, arg in enumerate(args):
        if arg != '-s': continue
        name, raw = args[i + 1].split('=', 1)
        value = json.loads(raw)
        if name.startswith('smtpServer.'):
            state['realm'].setdefault('smtpServer', {})[name.split('.', 1)[1]] = value
        else:
            state['realm'][name] = value
elif args[:2] == ['update', 'realms/master']:
    state['issuerChanged'] = True
path.write_text(json.dumps(state))
''')
        fake.chmod(0o700)
        script = (ROOT / 'deploy/keycloak/init.sh').read_text()
        self.script = self.directory / 'init.sh'
        self.script.write_text(script.replace('kc=/opt/keycloak/bin/kcadm.sh', 'kc=' + shlex.quote(str(fake))))
        self.env = {key: value for key, value in os.environ.items() if not key.startswith(('SMTP_', 'GOOGLE_'))}
        self.env.update(TEST_KEYCLOAK_STATE=str(self.state), KEYCLOAK_ADMIN_USER='test-admin',
                        KEYCLOAK_ADMIN_PASSWORD='test-only-password', KEYCLOAK_ADMIN_ORIGIN='http://localhost:19090')

    def run_init(self, **values):
        return subprocess.run(['/bin/bash', str(self.script)], env=self.env | values,
                              capture_output=True, text=True, timeout=10)

    def test_email_is_optional_and_clears_old_smtp_without_bypassing_verification(self):
        result = self.run_init()
        self.assertEqual(result.returncode, 0, result.stderr)
        realm = json.loads(self.state.read_text())['realm']
        self.assertEqual(realm['smtpServer'], {})
        self.assertFalse(realm['registrationAllowed'])
        self.assertFalse(realm['resetPasswordAllowed'])
        self.assertTrue(realm['verifyEmail'])

    def test_can_enable_email_and_disable_it_again_for_an_existing_realm(self):
        password = 'test-only-"quoted"\\password\nwith\tspaces'
        result = self.run_init(SMTP_ENABLED='true', SMTP_HOST='mail.test', SMTP_FROM='lumi@example.test',
                               SMTP_PORT='2525', SMTP_USER='smtp-test-user', SMTP_PASSWORD=password,
                               GOOGLE_CLIENT_ID='test-google-client', GOOGLE_CLIENT_SECRET='test-google-secret')
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(self.state.read_text())
        self.assertTrue(state['realm']['registrationAllowed'])
        self.assertTrue(state['realm']['resetPasswordAllowed'])
        self.assertTrue(state['realm']['verifyEmail'])
        self.assertEqual(state['realm']['smtpServer'], {'host': 'mail.test', 'port': '2525',
                         'from': 'lumi@example.test', 'auth': 'true', 'user': 'smtp-test-user',
                         'password': password, 'starttls': 'true', 'ssl': 'false'})
        self.assertEqual(state['calls'][-1][:2], ['update', 'realms/master'])
        result = self.run_init(SMTP_ENABLED='false', SMTP_HOST='mail.test', SMTP_FROM='lumi@example.test')
        self.assertEqual(result.returncode, 0, result.stderr)
        realm = json.loads(self.state.read_text())['realm']
        self.assertEqual(realm['smtpServer'], {})
        self.assertFalse(realm['registrationAllowed'])
        self.assertFalse(realm['resetPasswordAllowed'])
        self.assertTrue(realm['verifyEmail'])

    def test_enabled_email_requires_host_and_sender_before_contacting_keycloak(self):
        for values in ({'SMTP_HOST': 'mail.test'}, {'SMTP_FROM': 'lumi@example.test'}):
            result = self.run_init(SMTP_ENABLED='true', **values)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires SMTP_HOST and SMTP_FROM', result.stderr)
        self.assertEqual(json.loads(self.state.read_text())['calls'], [])

    def test_invalid_email_flag_fails_before_contacting_keycloak(self):
        result = self.run_init(SMTP_ENABLED='typo')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must be true or false', result.stderr)
        self.assertEqual(json.loads(self.state.read_text())['calls'], [])


if __name__ == '__main__':
    unittest.main()
