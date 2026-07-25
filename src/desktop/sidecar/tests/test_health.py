"""健康检查基础测试。

不依赖外部环境，验证 FastAPI app 可创建并响应 /api/v1/health。
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # 测试环境不强制令牌
    monkeypatch.delenv("DESKTOP_SIDECAR_TOKEN", raising=False)
    from desktop_backend.main import create_app

    return TestClient(create_app())


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_health_requires_token_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DESKTOP_SIDECAR_TOKEN", "secret-token")
    from desktop_backend.main import create_app

    client = TestClient(create_app())

    # 缺失 Authorization → 401
    no_auth = client.get("/api/v1/health")
    assert no_auth.status_code == 401

    # 错误 token → 401
    wrong = client.get(
        "/api/v1/health",
        headers={"Authorization": "Bearer wrong"},
    )
    assert wrong.status_code == 401

    # 正确 token → 200
    ok = client.get(
        "/api/v1/health",
        headers={"Authorization": "Bearer secret-token"},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "ok"
