"""Run `python -m forma.owner` in the API environment to set/reset the sole owner."""
from getpass import getpass
from sqlalchemy import delete, select
from .auth import hasher
from .db import AuthSessionRow, LoginLimitRow, OwnerRow, OWNER_ID, Session, init_db


def set_owner(username, password):
    if not 1 <= len(username.strip()) <= 100:
        raise ValueError("Login must contain 1–100 characters.")
    if not 15 <= len(password) <= 1024:
        raise ValueError("Use a password or passphrase with 15–1024 characters.")
    encoded = hasher.hash(password)
    with Session.begin() as db:
        row = db.scalar(select(OwnerRow).where(OwnerRow.id == OWNER_ID).with_for_update())
        if row:
            row.username, row.password_hash = username.strip(), encoded
        else:
            db.add(OwnerRow(id=OWNER_ID, username=username.strip(), password_hash=encoded))
        db.execute(delete(AuthSessionRow))
        db.execute(delete(LoginLimitRow))


def main():
    init_db()
    username = input("Owner login: ").strip()
    password = getpass("Password (at least 15 characters): ")
    if password != getpass("Repeat password: "):
        raise SystemExit("Passwords do not match. No changes made.")
    try:
        set_owner(username, password)
    except ValueError as exc:
        raise SystemExit(str(exc))
    print("Owner configured. Previous sessions revoked.")


if __name__ == "__main__":
    main()
