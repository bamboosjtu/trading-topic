"""FastAPI sidecar 入口。

架构约束（见 docs/product/ARCHITECTURE.md §9）：
- 只监听 127.0.0.1；
- 使用启动时生成的随机端口和会话令牌；
- 写操作必须在 SQLite 事务中完成（R1 实现阶段补全）。

环境变量：
- DESKTOP_SIDECAR_PORT：监听端口（由 Electron 主进程注入；缺失时回退 8001 用于独立调试）
- DESKTOP_SIDECAR_TOKEN：会话令牌（缺失时不强制鉴权，便于 pytest）
"""

from __future__ import annotations

import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import __version__


def _expected_token() -> str | None:
    return os.environ.get("DESKTOP_SIDECAR_TOKEN")


def _verify_token(authorization: Annotated[str | None, Header()] = None) -> None:
    """会话令牌校验。

    生产环境由 Electron 主进程注入 DESKTOP_SIDECAR_TOKEN；
    缺失时（pytest 或独立 uvicorn 调试）跳过校验。
    """
    expected = _expected_token()
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != expected:
        raise HTTPException(status_code=401, detail="invalid token")


def create_app() -> FastAPI:
    app = FastAPI(
        title="攒股收息 R1 Sidecar",
        version=__version__,
        docs_url="/docs" if not _expected_token() else None,
        redoc_url=None,
        openapi_url="/api/v1/openapi.json" if not _expected_token() else None,
    )

    # 仅允许本机 renderer 跨域（开发期 Vite 跑在 5173）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/api/v1/health", tags=["system"])
    def health(_: None = Depends(_verify_token)) -> dict[str, str]:
        """健康检查。"""
        return {
            "status": "ok",
            "version": __version__,
        }

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DESKTOP_SIDECAR_PORT", "8001"))
    uvicorn.run(
        "desktop_backend.main:app",
        host="127.0.0.1",
        port=port,
        reload=False,
    )
