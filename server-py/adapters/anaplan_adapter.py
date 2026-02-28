"""Anaplan engine adapter — REST API v2 integration."""

from __future__ import annotations

import base64
import os
import time

import httpx

from models import (
    CellWrite,
    CellWriteResult,
    ColumnDef,
    DataRow,
    Dimension,
    DimensionItem,
    LineItemMeta,
    ModelInfo,
    ModuleDataRequest,
    ModuleDataResponse,
    ModuleMeta,
    NumericFilterOp,
    ParentFilter,
    WorkspaceInfo,
    WorkspaceSchema,
)

from .base import EngineAdapter

ANAPLAN_AUTH_URL = "https://auth.anaplan.com/token/authenticate"
ANAPLAN_API_BASE = "https://api.anaplan.com/2/0"


def _map_anaplan_format(fmt: str) -> str:
    f = (fmt or "").lower()
    if "currency" in f or "money" in f:
        return "currency"
    if "percent" in f:
        return "percentage"
    if "number" in f or "decimal" in f or "integer" in f:
        return "number"
    return "text"


def _apply_numeric_filter(value: float | None, op: NumericFilterOp, low: float | None, high: float | None) -> bool:
    if value is None:
        return False
    if op == NumericFilterOp.ZERO:
        return value == 0
    if op == NumericFilterOp.NON_ZERO:
        return value != 0
    if low is None:
        return True
    if op == NumericFilterOp.GTE:
        return value >= low
    if op == NumericFilterOp.GT:
        return value > low
    if op == NumericFilterOp.LTE:
        return value <= low
    if op == NumericFilterOp.LT:
        return value < low
    if op == NumericFilterOp.BETWEEN:
        return low <= value <= (high if high is not None else low)
    return True


class AnaplanAdapter(EngineAdapter):
    def __init__(self) -> None:
        self._auth_token: str | None = None
        self._workspace_cache: list[dict] = []
        self._config: dict[str, str | None] = {}
        self._schema_cache: dict[str, WorkspaceSchema] = {}
        self._client = httpx.AsyncClient(timeout=60.0)

    @property
    def id(self) -> str:
        return "anaplan"

    @property
    def name(self) -> str:
        return "Anaplan"

    @property
    def engine_type(self) -> str:
        return "anaplan"

    async def connect(self, config: dict[str, str] | None = None) -> None:
        config = config or {}
        self._config = {
            "email": config.get("email") or os.environ.get("ANAPLAN_EMAIL"),
            "password": config.get("password") or os.environ.get("ANAPLAN_PASSWORD"),
            "token": config.get("token") or os.environ.get("ANAPLAN_TOKEN"),
        }

        if self._config["token"]:
            self._auth_token = self._config["token"]
        elif self._config["email"] and self._config["password"]:
            await self._authenticate()
        else:
            raise ValueError(
                "Anaplan adapter requires ANAPLAN_EMAIL + ANAPLAN_PASSWORD or ANAPLAN_TOKEN"
            )
        # Clear caches on reconnect
        self._workspace_cache.clear()
        self._schema_cache.clear()

    async def disconnect(self) -> None:
        self._auth_token = None
        self._workspace_cache.clear()
        self._schema_cache.clear()

    def is_connected(self) -> bool:
        return self._auth_token is not None

    # ── Workspaces ──

    async def get_workspaces(self) -> list[WorkspaceInfo]:
        self._ensure_connected()

        data = await self._api_get("/workspaces")
        self._workspace_cache = data.get("workspaces", [])
        return [
            WorkspaceInfo(id=ws["id"], name=ws["name"])
            for ws in self._workspace_cache
        ]

    # ── Models (Anaplan-specific: models within a workspace) ──

    async def get_models(self, workspace_id: str) -> list[ModelInfo]:
        self._ensure_connected()
        data = await self._api_get(f"/workspaces/{workspace_id}/models")
        return [
            ModelInfo(id=m["id"], name=m["name"])
            for m in data.get("models", [])
        ]

    # ── Schema ──

    async def get_schema(self, workspace_id: str) -> WorkspaceSchema:
        self._ensure_connected()

        if workspace_id in self._schema_cache:
            return self._schema_cache[workspace_id]

        ws_id, model_id = self._parse_workspace_id(workspace_id)
        base = f"/workspaces/{ws_id}/models/{model_id}"

        # Fetch lists (dimensions)
        lists_resp = await self._api_get(f"{base}/lists")
        dimensions = [
            Dimension(
                id=lst["id"],
                name=lst["name"],
                parent_dimension_id=lst.get("parent", {}).get("id"),
            )
            for lst in lists_resp.get("lists", [])
        ]

        # Fetch modules
        modules_resp = await self._api_get(f"{base}/modules")
        modules: list[ModuleMeta] = []
        for mod in modules_resp.get("modules", []):
            li_resp = await self._api_get(f"{base}/modules/{mod['id']}/lineItems")
            line_items = [
                LineItemMeta(
                    id=li["id"],
                    name=li["name"],
                    format=_map_anaplan_format(li.get("format", "")),
                    editable=not li.get("formula"),
                )
                for li in li_resp.get("items", [])
            ]
            modules.append(
                ModuleMeta(
                    id=mod["id"],
                    name=mod["name"],
                    dimension_ids=[d["id"] for d in mod.get("dimensions", [])],
                    line_items=line_items,
                )
            )

        # Versions
        versions_resp = await self._api_get(f"{base}/versions")
        versions = [
            DimensionItem(id=v["id"], name=v["name"])
            for v in versions_resp.get("versions", [])
        ]

        schema = WorkspaceSchema(dimensions=dimensions, modules=modules, versions=versions)
        self._schema_cache[workspace_id] = schema
        return schema

    async def get_dimension_items(
        self,
        workspace_id: str,
        dimension_id: str,
        parent_filter: ParentFilter | None = None,
    ) -> list[DimensionItem]:
        self._ensure_connected()
        ws_id, model_id = self._parse_workspace_id(workspace_id)

        resp = await self._api_get(
            f"/workspaces/{ws_id}/models/{model_id}/lists/{dimension_id}/items"
        )
        items = [
            DimensionItem(
                id=item["id"],
                name=item["name"],
                parent_item_id=item.get("parent", {}).get("id"),
            )
            for item in resp.get("listItems", [])
        ]

        if parent_filter and parent_filter.item_ids:
            items = [
                item
                for item in items
                if item.parent_item_id and item.parent_item_id in parent_filter.item_ids
            ]
        return items

    # ── Line item values ──

    async def get_line_item_values(
        self,
        workspace_id: str,
        module_id: str,
        line_item_id: str,
        version: str,
    ) -> list[str]:
        """Get distinct text values for a line item by exporting module data."""
        self._ensure_connected()
        # Use a minimal data fetch to extract unique values
        request = ModuleDataRequest(version=version, page=1, page_size=999999)
        data = await self.get_module_data(workspace_id, module_id, request)
        values: set[str] = set()
        for row in data.rows:
            val = row.cells.get(line_item_id)
            if val is not None and isinstance(val, str) and val.strip():
                values.add(str(val))
        return sorted(values)

    # ── Data ──

    async def get_module_data(
        self,
        workspace_id: str,
        module_id: str,
        request: ModuleDataRequest,
    ) -> ModuleDataResponse:
        self._ensure_connected()
        ws_id, model_id = self._parse_workspace_id(workspace_id)
        base = f"/workspaces/{ws_id}/models/{model_id}"

        schema = await self.get_schema(workspace_id)
        mod = next((m for m in schema.modules if m.id == module_id), None)
        if mod is None:
            raise ValueError(f"Module {module_id} not found")

        # Create export
        export_def = await self._api_post(
            f"{base}/modules/{module_id}/exports",
            {"exportType": "TABULAR_SINGLE_COLUMN"},
        )
        export_id = export_def.get("exportMetadata", {}).get("exportId")
        if not export_id:
            raise ValueError("Failed to create Anaplan export")

        # Run the export
        await self._api_post(f"{base}/exports/{export_id}/tasks", {})

        # Read chunks
        chunk_resp = await self._api_get(f"{base}/exports/{export_id}/chunks")
        all_lines: list[str] = []
        for chunk in chunk_resp.get("chunks", []):
            raw = await self._api_get_raw(
                f"{base}/exports/{export_id}/chunks/{chunk['id']}"
            )
            all_lines.extend(raw.split("\n"))

        all_lines = [line for line in all_lines if line.strip()]
        header_line = all_lines[0] if all_lines else ""
        headers = [h.strip().strip('"') for h in header_line.split(",")]

        # Build columns
        columns: list[ColumnDef] = []
        for i, h in enumerate(headers):
            li = next((l for l in mod.line_items if l.name == h), None)
            dim = next((d for d in schema.dimensions if d.name == h), None)
            if li:
                columns.append(
                    ColumnDef(
                        key=li.id,
                        label=li.name,
                        type="value",
                        format=li.format,
                        editable=li.editable,
                        line_item_id=li.id,
                    )
                )
            else:
                columns.append(
                    ColumnDef(
                        key=dim.id if dim else f"col_{i}",
                        label=h,
                        type="dimension",
                    )
                )

        # Parse rows
        data_lines = all_lines[1:]
        rows: list[DataRow] = []
        for idx, line in enumerate(data_lines):
            values = [v.strip().strip('"') for v in line.split(",")]
            cells: dict[str, str | int | float | None] = {}
            for i, h in enumerate(headers):
                col = columns[i]
                val = values[i] if i < len(values) else None
                if col.type == "value" and val is not None:
                    if col.format in ("number", "currency", "percentage"):
                        try:
                            cells[col.key] = float(val)
                        except ValueError:
                            cells[col.key] = val
                    else:
                        cells[col.key] = val
                else:
                    cells[col.key] = val
            rows.append(DataRow(id=f"anaplan_row_{idx}", cells=cells))

        # Client-side filtering: dimension filters
        filtered = rows
        for dim_id, selected_ids in request.filters.items():
            if not selected_ids:
                continue
            dim = next((d for d in schema.dimensions if d.id == dim_id), None)
            if not dim:
                continue
            items = await self.get_dimension_items(workspace_id, dim_id)
            selected_names = {item.name for item in items if item.id in selected_ids}
            filtered = [
                row
                for row in filtered
                if row.cells.get(dim_id) and str(row.cells[dim_id]) in selected_names
            ]

        # Client-side filtering: line item text filters
        for li_id, selected_values in request.line_item_filters.items():
            if not selected_values:
                continue
            filtered = [
                row
                for row in filtered
                if row.cells.get(li_id) is not None and str(row.cells[li_id]) in selected_values
            ]

        # Client-side filtering: numeric filters
        for nf in request.numeric_filters:
            filtered = [
                row
                for row in filtered
                if _apply_numeric_filter(
                    _to_float(row.cells.get(nf.line_item_id)),
                    nf.operator,
                    nf.value,
                    nf.value_high,
                )
            ]

        total_rows = len(filtered)
        page = request.page
        page_size = request.page_size
        start = (page - 1) * page_size
        paged = filtered[start : start + page_size]

        return ModuleDataResponse(
            columns=columns, rows=paged, page=page, page_size=page_size, total_rows=total_rows
        )

    async def write_cells(
        self,
        workspace_id: str,
        module_id: str,
        version: str,
        cells: list[CellWrite],
    ) -> CellWriteResult:
        self._ensure_connected()
        ws_id, model_id = self._parse_workspace_id(workspace_id)
        base = f"/workspaces/{ws_id}/models/{model_id}"

        try:
            schema = await self.get_schema(workspace_id)
            mod = next((m for m in schema.modules if m.id == module_id), None)
            if mod is None:
                raise ValueError(f"Module {module_id} not found")

            import_def = await self._api_post(
                f"{base}/imports",
                {"name": f"write_{int(time.time() * 1000)}", "importDataSourceId": module_id},
            )
            imports = import_def.get("imports", [])
            if not imports or "id" not in imports[0]:
                raise ValueError("Failed to create Anaplan import")

            import_id = imports[0]["id"]
            await self._api_post(f"{base}/imports/{import_id}/tasks", {"localeName": "en_US"})

            return CellWriteResult(success=True)
        except Exception as e:
            return CellWriteResult(success=False, errors=[str(e)])

    # ── Private helpers ──

    async def _authenticate(self) -> None:
        credentials = base64.b64encode(
            f"{self._config['email']}:{self._config['password']}".encode()
        ).decode()

        resp = await self._client.post(
            ANAPLAN_AUTH_URL,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/json",
            },
            json={"purpose": "planning-ux"},
        )
        if resp.status_code >= 400:
            raise ValueError(
                f"Anaplan authentication failed: {resp.status_code} {resp.reason_phrase}"
            )

        data = resp.json()
        self._auth_token = data.get("tokenInfo", {}).get("tokenValue")
        if not self._auth_token:
            raise ValueError("Anaplan authentication returned no token")

    def _ensure_connected(self) -> None:
        if not self._auth_token:
            raise ValueError("Anaplan adapter is not connected. Call connect() first.")

    def _parse_workspace_id(self, workspace_id: str) -> tuple[str, str]:
        parts = workspace_id.split(":")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ValueError(
                f'Invalid workspace ID "{workspace_id}". Expected format: "workspaceId:modelId"'
            )
        return parts[0], parts[1]

    async def _api_get(self, path: str) -> dict:
        resp = await self._client.get(
            f"{ANAPLAN_API_BASE}{path}",
            headers={
                "Authorization": f"AnaplanAuthToken {self._auth_token}",
                "Content-Type": "application/json",
            },
        )
        if resp.status_code >= 400:
            raise ValueError(f"Anaplan API GET {path} failed: {resp.status_code}")
        return resp.json()

    async def _api_get_raw(self, path: str) -> str:
        resp = await self._client.get(
            f"{ANAPLAN_API_BASE}{path}",
            headers={
                "Authorization": f"AnaplanAuthToken {self._auth_token}",
                "Accept": "text/csv",
            },
        )
        if resp.status_code >= 400:
            raise ValueError(f"Anaplan API GET {path} failed: {resp.status_code}")
        return resp.text

    async def _api_post(self, path: str, body: dict) -> dict:
        resp = await self._client.post(
            f"{ANAPLAN_API_BASE}{path}",
            headers={
                "Authorization": f"AnaplanAuthToken {self._auth_token}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        if resp.status_code >= 400:
            raise ValueError(f"Anaplan API POST {path} failed: {resp.status_code}")
        return resp.json()


def _to_float(val: str | int | float | None) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
