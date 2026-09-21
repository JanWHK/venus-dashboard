"""Owner plus invited viewers. Opaque sessions are hashed at rest."""
import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from database import Account, LoginSession, SessionLocal

router = APIRouter(prefix="/api/auth")
COOKIE = "helio_session"
SECURE = os.getenv("COOKIE_SECURE", "true").lower() == "true"
TTL = 12 * 3600
setup_token = None
attempts = defaultdict(deque)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000).hex()
    return f"{salt}${digest}"


def verify_password(password, encoded):
    return hmac.compare_digest(password_hash(password, encoded.split("$", 1)[0]), encoded)


DUMMY_HASH = password_hash(secrets.token_urlsafe(24))


async def initialize_auth():
    global setup_token
    async with SessionLocal() as session:
        if await session.get(Account, 1) is None:
            setup_token = os.getenv("DASHBOARD_SETUP_TOKEN") or secrets.token_urlsafe(24)
            if not os.getenv("DASHBOARD_SETUP_TOKEN"):
                logging.getLogger("uvicorn.error").warning("Helio first-use setup key: %s", setup_token)


def require_csrf_header(request: Request):
    if request.headers.get("X-Helio-Request") != "1":
        raise HTTPException(403, "Missing request verification header")


async def rate_limit(request: Request):
    now = time.monotonic()
    for key in list(attempts):
        while attempts[key] and now - attempts[key][0] > 300:
            attempts[key].popleft()
        if not attempts[key]:
            del attempts[key]
    host = request.client.host if request.client else "unknown"
    for key, limit in (("global", 100), ("host:" + host, 10)):
        if len(attempts[key]) >= limit:
            raise HTTPException(429, "Too many attempts. Try again in five minutes.", headers={"Retry-After": "300"})
    attempts["global"].append(now)
    attempts["host:" + host].append(now)


async def require_user(request: Request):
    token = request.cookies.get(COOKIE, "")
    if not token or len(token) > 128:
        raise HTTPException(401, "Please sign in")
    async with SessionLocal() as session:
        login = await session.get(LoginSession, hashlib.sha256(token.encode()).hexdigest())
        if login is None or login.expires_at <= datetime.now(timezone.utc):
            raise HTTPException(401, "Session expired. Please sign in again.")
        account = await session.get(Account, login.account_id) if login.account_id else None
        if account is None:
            raise HTTPException(401, "Session expired. Please sign in again.")
        return {"id": account.id, "username": account.username, "role": account.role or "viewer"}


async def require_admin(user=Depends(require_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Only the workspace owner can do that")
    return user


async def create_session(response: Response, account: Account):
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        await session.execute(delete(LoginSession).where(LoginSession.expires_at <= now))
        session.add(LoginSession(token_hash=hashlib.sha256(token.encode()).hexdigest(),
                                 expires_at=now + timedelta(seconds=TTL), account_id=account.id))
        await session.commit()
    response.set_cookie(COOKIE, token, max_age=TTL, httponly=True, secure=SECURE, samesite="strict", path="/api")
    return {"id": account.id, "username": account.username, "role": account.role or "viewer"}


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class Setup(Credentials):
    password: str = Field(min_length=12, max_length=256)
    setup_key: str = Field(min_length=1, max_length=256)


@router.get("/status")
async def status():
    async with SessionLocal() as session:
        return {"setup_required": await session.get(Account, 1) is None}


@router.post("/setup", dependencies=[Depends(require_csrf_header), Depends(rate_limit)])
async def setup(body: Setup, response: Response):
    global setup_token
    if not setup_token or not hmac.compare_digest(body.setup_key.encode(), setup_token.encode()):
        raise HTTPException(403, "Invalid or expired setup key")
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "Enter a username")
    encoded = await asyncio.to_thread(password_hash, body.password)
    account = Account(id=1, username=username, password_hash=encoded, role="admin")
    try:
        async with SessionLocal() as session:
            session.add(account)
            await session.commit()
    except IntegrityError:
        raise HTTPException(409, "Workspace already configured")
    setup_token = None
    return await create_session(response, account)


@router.post("/login", dependencies=[Depends(require_csrf_header), Depends(rate_limit)])
async def login(body: Credentials, response: Response):
    username = body.username.strip()
    async with SessionLocal() as session:
        account = (await session.execute(
            select(Account).where(Account.username == username))).scalar_one_or_none()
        valid = await asyncio.to_thread(verify_password, body.password, account.password_hash if account else DUMMY_HASH)
        if not valid or not account:
            raise HTTPException(401, "Username or password is incorrect")
        return await create_session(response, account)


@router.get("/me")
async def me(user=Depends(require_user)):
    return user


@router.post("/logout", dependencies=[Depends(require_csrf_header)])
async def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE, "")
    async with SessionLocal() as session:
        await session.execute(delete(LoginSession).where(LoginSession.token_hash == hashlib.sha256(token.encode()).hexdigest()))
        await session.commit()
    response.delete_cookie(COOKIE, path="/api", secure=SECURE, httponly=True, samesite="strict")
    return {"ok": True}


class NewUser(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=256)
    role: str = Field(default="viewer", pattern="^(admin|viewer)$")


class NewPassword(BaseModel):
    new_password: str = Field(min_length=12, max_length=256)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


async def hash_and_store_password(session, account: Account, password):
    encoded = await asyncio.to_thread(password_hash, password)
    account.password_hash = encoded
    await session.commit()


@router.get("/users")
async def list_users(user=Depends(require_admin)):
    async with SessionLocal() as session:
        rows = (await session.execute(select(Account).order_by(Account.id))).scalars().all()
    return [{"id": row.id, "username": row.username, "role": row.role or "viewer"} for row in rows]


@router.post("/users", dependencies=[Depends(require_csrf_header)])
async def create_user(body: NewUser, user=Depends(require_admin)):
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "Enter a username")
    encoded = await asyncio.to_thread(password_hash, body.password)
    async with SessionLocal() as session:
        if (await session.execute(select(Account).where(Account.username == username))).scalar_one_or_none():
            raise HTTPException(409, "That username is already taken")
        account = Account(username=username, password_hash=encoded, role=body.role)
        session.add(account)
        await session.commit()
        return {"id": account.id, "username": account.username, "role": account.role}


@router.delete("/users/{account_id}", dependencies=[Depends(require_csrf_header)])
async def delete_user(account_id: int, user=Depends(require_admin)):
    if account_id == 1:
        raise HTTPException(403, "The workspace owner cannot be removed")
    if account_id == user["id"]:
        raise HTTPException(403, "You cannot remove your own account")
    async with SessionLocal() as session:
        account = await session.get(Account, account_id)
        if account is None:
            raise HTTPException(404, "No such user")
        await session.delete(account)
        await session.execute(delete(LoginSession).where(LoginSession.account_id == account_id))
        await session.commit()
    return {"ok": True}


@router.put("/users/{account_id}/password", dependencies=[Depends(require_csrf_header)])
async def reset_password(account_id: int, body: NewPassword, user=Depends(require_admin)):
    async with SessionLocal() as session:
        account = await session.get(Account, account_id)
        if account is None:
            raise HTTPException(404, "No such user")
        await hash_and_store_password(session, account, body.new_password)
        await session.execute(delete(LoginSession).where(LoginSession.account_id == account_id))
        await session.commit()
    return {"ok": True}


@router.put("/me/password", dependencies=[Depends(require_csrf_header)])
async def change_own_password(body: PasswordChange, user=Depends(require_user)):
    async with SessionLocal() as session:
        account = await session.get(Account, user["id"])
        if account is None:
            raise HTTPException(401, "Please sign in")
        valid = await asyncio.to_thread(verify_password, body.current_password, account.password_hash)
        if not valid:
            raise HTTPException(401, "Your current password is incorrect")
        await hash_and_store_password(session, account, body.new_password)
        await session.commit()
    return {"ok": True}
