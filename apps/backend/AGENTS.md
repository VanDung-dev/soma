# Backend ownership

- Read the Backend development section of the repository root `README.md` before backend work. `apps/backend/` is the single backend application root.
- Extend `app/main.py`, `app/api/router.py`, and `app/modules/<domain>/` in place. Keep database setup in `app/database.py`, schema migrations in `migrations/`, and backend tests in `tests/test_*.py`.
- Python dependencies are managed in the repository root's `requirements.txt` and `requirements-dev.txt`. Use the repository `.venv` for local execution.
- SQLite is the development/test database. Tests use temporary databases and must not modify `data/development.sqlite3`.
- Register implemented domain routers through `app/api/router.py` under `/api/v1`. Reserve `main.py` for application composition and lifecycle.
- Lessons reference the existing catalog/model structure IDs. One lesson format serves all authors; keep model rendering and camera mechanics in the existing frontend/Rust viewer.
- Authentication, lesson schema, permissions, and frontend integration are implementation work for the backend owner; this scaffold does not define them. Do not substitute placeholder successful responses for unimplemented APIs.
- Run the backend test command in the repository root `README.md`, including the backend location check, before handing off changes.
