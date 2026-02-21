"""Planning API server — FastAPI entry point."""

from __future__ import annotations

import json
import os
import sys

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from engine_manager import EngineManager
from adapters.mock_adapter import MockAdapter
from adapters.anaplan_adapter import AnaplanAdapter
from models import (
    ConnectRequest,
    ModuleDataRequest,
    ParentFilter,
    WriteCellsRequest,
)

app = FastAPI(title="Planning UX API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engines = EngineManager()


@app.on_event("startup")
async def startup() -> None:
    mock = MockAdapter()
    await mock.connect()
    engines.register(mock)

    anaplan = AnaplanAdapter()
    engines.register(anaplan)


def _camel_response(data) -> JSONResponse:
    """Serialize a Pydantic model (or list of models) to camelCase JSON."""
    if isinstance(data, list):
        content = [
            item.model_dump(by_alias=True, exclude_none=True) if hasattr(item, "model_dump") else item
            for item in data
        ]
    elif hasattr(data, "model_dump"):
        content = data.model_dump(by_alias=True, exclude_none=True)
    else:
        content = data
    return JSONResponse(content=content)


# ── Engines ──


@app.get("/api/engines")
async def list_engines():
    return _camel_response(engines.list())


@app.post("/api/engines/{engine_id}/connect")
async def connect_engine(engine_id: str, body: ConnectRequest | None = None):
    try:
        adapter = engines.get(engine_id)
        config = body.model_dump(exclude_none=True) if body else None
        await adapter.connect(config or None)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Workspaces ──


@app.get("/api/engines/{engine_id}/workspaces")
async def list_workspaces(engine_id: str):
    try:
        adapter = engines.get(engine_id)
        workspaces = await adapter.get_workspaces()
        return _camel_response(workspaces)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Schema ──


@app.get("/api/engines/{engine_id}/workspaces/{ws_id}/schema")
async def get_schema(engine_id: str, ws_id: str):
    try:
        adapter = engines.get(engine_id)
        schema = await adapter.get_schema(ws_id)
        return _camel_response(schema)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Dimension items ──


@app.get("/api/engines/{engine_id}/workspaces/{ws_id}/dimensions/{dim_id}/items")
async def get_dimension_items(
    engine_id: str,
    ws_id: str,
    dim_id: str,
    parentDimensionId: str | None = Query(default=None),
    parentItemIds: str | None = Query(default=None),
):
    try:
        adapter = engines.get(engine_id)
        parent_filter = None
        if parentDimensionId and parentItemIds:
            parent_filter = ParentFilter(
                dimension_id=parentDimensionId,
                item_ids=parentItemIds.split(","),
            )
        items = await adapter.get_dimension_items(ws_id, dim_id, parent_filter)
        return _camel_response(items)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Module data ──


@app.get("/api/engines/{engine_id}/workspaces/{ws_id}/modules/{module_id}/data")
async def get_module_data(
    engine_id: str,
    ws_id: str,
    module_id: str,
    filters: str | None = Query(default=None),
    version: str = Query(default="actual"),
    lineItemId: str | None = Query(default=None),
    page: int = Query(default=1),
    pageSize: int = Query(default=50),
):
    try:
        adapter = engines.get(engine_id)
        parsed_filters = json.loads(filters) if filters else {}
        request = ModuleDataRequest(
            filters=parsed_filters,
            version=version,
            line_item_id=lineItemId,
            page=page,
            page_size=pageSize,
        )
        data = await adapter.get_module_data(ws_id, module_id, request)
        return _camel_response(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Write-back ──


@app.post("/api/engines/{engine_id}/workspaces/{ws_id}/modules/{module_id}/cells")
async def write_cells(
    engine_id: str,
    ws_id: str,
    module_id: str,
    body: WriteCellsRequest,
):
    try:
        adapter = engines.get(engine_id)
        result = await adapter.write_cells(ws_id, module_id, body.version, body.cells)
        return _camel_response(result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 3001))
    print(f"Planning API server running on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
