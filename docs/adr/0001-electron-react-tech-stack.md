# Electron + React as Desktop Tech Stack

We chose Electron + React for the desktop application. The `ssh2` library provides the most complete support for SSH connections, user switching (`sudo`/`su`), and SFTP file transfers among all desktop options. React's ecosystem (Ant Design Pro for UI, `@xyflow/react` for pipeline visualization) enables a polished interface without building from scratch. The trade-off is higher memory usage compared to Tauri or native WPF, which is acceptable given the developer productivity gains.

## Considered Options

- **Tauri + React** — lower memory, but SSH support requires Rust-side implementation with a less mature ecosystem
- **WPF / WinUI 3** — best native performance, but slow UI development and poor layout flexibility
- **.NET MAUI** — mature SSH.NET library, but C# frontend is less flexible for rich interactive UIs
