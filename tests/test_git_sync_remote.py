"""Remote update status without network."""

from unittest.mock import MagicMock, patch

from print_partner.core.git_sync import remote_update_status, short_commit_sha


def test_short_commit_sha():
    assert short_commit_sha("abcdef1234567890") == "abcdef1"
    assert short_commit_sha(None) == "—"


def test_remote_update_status_up_to_date(tmp_path):
    repo_path = tmp_path / "repo"
    repo_path.mkdir()
    mock_repo = MagicMock()
    mock_repo.head.commit.hexsha = "aaa" * 10 + "bbb"
    mock_repo.git.ls_remote.return_value = "aaa" * 10 + "bbb\trefs/heads/main"

    with patch("print_partner.core.git_sync.Repo", return_value=mock_repo):
        assert (
            remote_update_status(repo_path, "https://github.com/x/y.git", "main", "aaa" * 10 + "bbb")
            == "up_to_date"
        )


def test_remote_update_status_updates_available(tmp_path):
    repo_path = tmp_path / "repo"
    repo_path.mkdir()
    mock_repo = MagicMock()
    mock_repo.head.commit.hexsha = "old" * 10 + "sha"
    mock_repo.git.ls_remote.return_value = "new" * 10 + "sha\trefs/heads/main"

    with patch("print_partner.core.git_sync.Repo", return_value=mock_repo):
        assert (
            remote_update_status(repo_path, "https://github.com/x/y.git", "main", "old" * 10 + "sha")
            == "updates_available"
        )


def test_remote_update_status_file_url_unknown(tmp_path):
    assert remote_update_status(tmp_path, "file:///tmp", "main", None) == "unknown"
