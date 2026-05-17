# SSH Connection Pool with Idle Timeout

SSH connections are managed via a global connection pool. Pipeline Runs reuse existing connections to the same Server rather than establishing new ones each time. Connections are closed after an idle timeout (no active commands for a configurable period). We considered per-Run connections (simpler but slow due to repeated SSH handshakes) and persistent always-on connections (wastes resources when servers aren't in use). The pool with idle timeout balances performance and resource efficiency.
