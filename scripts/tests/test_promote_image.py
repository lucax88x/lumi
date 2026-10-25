import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from test_deploy import deploy, release

spec = importlib.util.spec_from_file_location('promote_image', Path(__file__).resolve().parents[1] / 'promote-image.py')
promoter = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'deploy': deploy}):
    spec.loader.exec_module(promoter)


class PromotionTests(unittest.TestCase):
    def promote(self, head='a' * 40, attempt=1):
        with patch.object(promoter.subprocess, 'check_output', side_effect=[
                json.dumps({'object': {'sha': head}}).encode(), json.dumps({'run_attempt': attempt}).encode()]), \
                patch.object(promoter.subprocess, 'run') as docker, patch('sys.stdout', new_callable=io.StringIO):
            promoted = promoter.promote(release(), 101, 1, 'a' * 40)
        return promoted, docker

    def test_current_revision_promotes_exact_digest(self):
        promoted, docker = self.promote()
        self.assertTrue(promoted)
        self.assertEqual(docker.call_args.args[0][-1], release()['image'])
        self.assertIn('ghcr.io/lucax88x/lumi:main', docker.call_args.args[0])
        self.assertTrue(docker.call_args.kwargs['check'])

    def test_superseded_commit_or_attempt_never_moves_main_tag(self):
        for kwargs in [{'head': 'b' * 40}, {'attempt': 2}]:
            promoted, docker = self.promote(**kwargs)
            self.assertFalse(promoted)
            docker.assert_not_called()

    def test_invalid_release_does_not_contact_registry(self):
        with patch.object(promoter.subprocess, 'run') as docker, self.assertRaises(deploy.DeployError):
            promoter.promote(release() | {'image': 'other/image:main'}, 101, 1, 'a' * 40)
        docker.assert_not_called()
