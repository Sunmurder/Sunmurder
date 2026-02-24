"""Pydantic models — mirrors shared/types.ts for the Python backend.

All models use camelCase aliases to match the frontend's expected JSON format.
Internally we use snake_case (Python convention), but serialization produces camelCase.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


def _to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


class CamelModel(BaseModel):
    """Base model that serializes to camelCase and accepts both cases as input."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )


# ── Dimension model ──

CellFormat = Literal["number", "currency", "percentage", "text"]


class Dimension(CamelModel):
    id: str
    name: str
    parent_dimension_id: Optional[str] = None


class DimensionItem(CamelModel):
    id: str
    name: str
    parent_item_id: Optional[str] = None


# ── Module / line-item metadata ──


class LineItemMeta(CamelModel):
    id: str
    name: str
    format: CellFormat
    editable: bool


class ModuleMeta(CamelModel):
    id: str
    name: str
    dimension_ids: list[str]
    line_items: list[LineItemMeta]


# ── Schema discovery ──


class WorkspaceSchema(CamelModel):
    dimensions: list[Dimension]
    modules: list[ModuleMeta]
    versions: list[DimensionItem]


# ── Data fetching / write-back ──


class NumericFilterOp(str, Enum):
    GTE = "gte"
    GT = "gt"
    LTE = "lte"
    LT = "lt"
    ZERO = "zero"
    NON_ZERO = "non_zero"
    BETWEEN = "between"


class NumericFilter(CamelModel):
    line_item_id: str
    operator: NumericFilterOp
    value: Optional[float] = None
    value_high: Optional[float] = None


class ModuleDataRequest(CamelModel):
    filters: dict[str, list[str]] = {}
    line_item_filters: dict[str, list[str]] = {}
    numeric_filters: list[NumericFilter] = []
    version: str = "actual"
    line_item_id: Optional[str] = None
    page: int = 1
    page_size: int = 50


class ColumnDef(CamelModel):
    key: str
    label: str
    type: Literal["dimension", "value"]
    format: Optional[CellFormat] = None
    editable: Optional[bool] = None
    line_item_id: Optional[str] = None
    time_period_id: Optional[str] = None


class DataRow(CamelModel):
    id: str
    cells: dict[str, str | int | float | None]


class ModuleDataResponse(CamelModel):
    columns: list[ColumnDef]
    rows: list[DataRow]
    page: int
    page_size: int
    total_rows: int


class CellWrite(CamelModel):
    row_id: str
    column_key: str
    value: str | int | float


class CellWriteResult(CamelModel):
    success: bool
    errors: Optional[list[str]] = None


# ── Engine / workspace ──


class EngineInfo(CamelModel):
    id: str
    name: str
    type: str
    connected: bool


class WorkspaceInfo(CamelModel):
    id: str
    name: str


# ── Request bodies ──


class ConnectRequest(CamelModel):
    email: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None


class WriteCellsRequest(CamelModel):
    version: str
    cells: list[CellWrite]


class ParentFilter(CamelModel):
    dimension_id: str
    item_ids: list[str]


# ── Saved connections ──


class SavedConnection(CamelModel):
    id: str
    name: str
    engine_id: str
    token: str
    created_at: str


class SaveConnectionRequest(CamelModel):
    name: str
    engine_id: str
    token: str


# ── Model info (for engines that expose models within workspaces) ──


class ModelInfo(CamelModel):
    id: str
    name: str
