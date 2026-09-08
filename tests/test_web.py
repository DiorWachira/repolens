from __future__ import annotations

import unittest

from repolens.web import github_repo_url


class TestGithubUrls(unittest.TestCase):
    def test_parses_repository_url_and_git_suffix(self) -> None:
        self.assertEqual(github_repo_url("https://github.com/DiorWachira/repolens.git"), ("DiorWachira", "repolens"))

    def test_rejects_non_github_url(self) -> None:
        with self.assertRaises(ValueError):
            github_repo_url("https://gitlab.com/example/project")

    def test_rejects_repository_url_with_extra_path(self) -> None:
        with self.assertRaises(ValueError):
            github_repo_url("https://github.com/example/project/issues")


if __name__ == "__main__":
    unittest.main()