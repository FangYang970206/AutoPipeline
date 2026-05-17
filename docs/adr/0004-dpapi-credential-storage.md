# SSH Credential Storage via Windows DPAPI

SSH passwords and private keys are encrypted using Windows DPAPI via the `keytar` library and stored in the Windows Credential Manager, not in SQLite. We considered storing credentials directly in SQLite (simpler, but plaintext-readable by anyone with file access) and AES encryption with a user-supplied master password (more portable, but adds UX friction). DPAPI ties encryption to the Windows user session with zero extra UX cost, which is the right trade-off for a single-user desktop app.
