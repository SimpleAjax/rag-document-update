"""Report whether the local Codex CLI is available without exposing credentials."""

import shutil
import subprocess


def codex_status() -> str:
    executable = shutil.which("codex")
    if not executable:
        return "unavailable"
    try:
        result = subprocess.run(
            [executable, "login", "status"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "unavailable"
    return "signed in" if result.returncode == 0 else "sign-in required"


if __name__ == "__main__":
    print(f"Codex CLI: {codex_status()}")
