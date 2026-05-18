from unittest.mock import patch

from PySide6.QtCore import QCoreApplication

from print_partner.core.git_sync import SyncResult
from print_partner.ui.sync_worker import SyncAllWorker, SyncProjectSpec

_app = QCoreApplication.instance() or QCoreApplication([])


def test_sync_all_worker_emits_results():
    specs = [SyncProjectSpec(1, "A", "https://example.com/a.git", "main")]
    worker = SyncAllWorker(specs)
    done: list[tuple[int, object]] = []

    def on_done(pid: int, result: object) -> None:
        done.append((pid, result))

    worker.project_done.connect(on_done)
    fake = SyncResult(
        local_path=__import__("pathlib").Path("/tmp/a"),
        commit_sha="abc",
        last_synced_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    )
    with patch("print_partner.ui.sync_worker.git_sync.sync_repository", return_value=fake):
        worker.run()
    assert len(done) == 1
    assert done[0][0] == 1
    assert isinstance(done[0][1], SyncResult)
