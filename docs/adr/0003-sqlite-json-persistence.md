# SQLite + JSON Export for Data Persistence

Pipeline definitions, Server configurations, and Run history are stored in a local SQLite database. We also support JSON export/import for backup and migration. Pure JSON files were considered but lack efficient querying for run history. SQLite-only was considered but makes portability harder. The hybrid gives structured runtime storage without sacrificing portability.
