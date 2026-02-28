"""Mock planning engine adapter — fully functional in-memory simulator."""

from __future__ import annotations

from itertools import product as cartesian_product

from models import (
    CellWrite,
    CellWriteResult,
    ColumnDef,
    DataRow,
    Dimension,
    DimensionItem,
    LineItemMeta,
    ModuleDataRequest,
    ModuleDataResponse,
    ModuleMeta,
    NumericFilterOp,
    ParentFilter,
    WorkspaceInfo,
    WorkspaceSchema,
)

from .base import EngineAdapter

# ── Seeded random ──


def _seeded_random(seed: int):
    s = seed

    def _next() -> float:
        nonlocal s
        s = (s * 16807) % 2147483647
        return (s - 1) / 2147483646

    return _next


# ── Static reference data ──

VERSIONS: list[DimensionItem] = [
    DimensionItem(id="actual", name="Actual"),
    DimensionItem(id="budget", name="Budget 2024"),
    DimensionItem(id="forecast", name="Forecast Q2"),
]

DIMENSIONS: list[Dimension] = [
    Dimension(id="time", name="Time Period"),
    Dimension(id="product", name="Product Line"),
    Dimension(id="region", name="Region"),
    Dimension(id="subregion", name="Sub-Region", parent_dimension_id="region"),
    Dimension(id="department", name="Department"),
    Dimension(id="cost_center", name="Cost Center"),
    Dimension(id="account_code", name="Account Code"),
]

DIM_ITEMS: dict[str, list[DimensionItem]] = {
    "time": [
        DimensionItem(id="q1_24", name="Q1 2024"),
        DimensionItem(id="q2_24", name="Q2 2024"),
        DimensionItem(id="q3_24", name="Q3 2024"),
        DimensionItem(id="q4_24", name="Q4 2024"),
        DimensionItem(id="q1_25", name="Q1 2025"),
        DimensionItem(id="q2_25", name="Q2 2025"),
    ],
    "product": [
        DimensionItem(id="electronics", name="Electronics"),
        DimensionItem(id="apparel", name="Apparel"),
        DimensionItem(id="home", name="Home & Garden"),
    ],
    "region": [
        DimensionItem(id="na", name="North America"),
        DimensionItem(id="eu", name="Europe"),
        DimensionItem(id="apac", name="Asia Pacific"),
    ],
    "subregion": [
        DimensionItem(id="us", name="United States", parent_item_id="na"),
        DimensionItem(id="ca", name="Canada", parent_item_id="na"),
        DimensionItem(id="uk", name="United Kingdom", parent_item_id="eu"),
        DimensionItem(id="de", name="Germany", parent_item_id="eu"),
        DimensionItem(id="fr", name="France", parent_item_id="eu"),
        DimensionItem(id="jp", name="Japan", parent_item_id="apac"),
        DimensionItem(id="au", name="Australia", parent_item_id="apac"),
    ],
    "department": [
        DimensionItem(id="sales", name="Sales"),
        DimensionItem(id="marketing", name="Marketing"),
        DimensionItem(id="operations", name="Operations"),
        DimensionItem(id="rnd", name="R&D"),
    ],
    "cost_center": [
        DimensionItem(id="cc100", name="CC-100 Corporate"),
        DimensionItem(id="cc200", name="CC-200 Engineering"),
        DimensionItem(id="cc300", name="CC-300 Marketing"),
        DimensionItem(id="cc400", name="CC-400 Sales"),
    ],
    "account_code": [
        DimensionItem(id="ac5001", name="5001 - Salaries"),
        DimensionItem(id="ac5002", name="5002 - Benefits"),
        DimensionItem(id="ac6001", name="6001 - Travel"),
        DimensionItem(id="ac6002", name="6002 - Software"),
        DimensionItem(id="ac7001", name="7001 - Facilities"),
    ],
}

# Text values for line item text filters
ROUTE_VALUES = ["Direct", "Channel", "Online", "Retail"]
MANAGER_VALUES = ["Alice Chen", "Bob Davis", "Carol White", "David Kim", "Eva Martinez"]
COST_TYPE_VALUES = ["Fixed", "Variable", "Semi-Variable"]
REGION_LABELS = ["North", "South", "East", "West"]

MODULES: list[ModuleMeta] = [
    ModuleMeta(
        id="revenue",
        name="Revenue Planning",
        dimension_ids=["time", "product", "subregion"],
        line_items=[
            LineItemMeta(id="route", name="Route", format="text", editable=True),
            LineItemMeta(id="manager", name="Manager", format="text", editable=True),
            LineItemMeta(id="units", name="Units Sold", format="number", editable=True),
            LineItemMeta(id="price", name="Avg Price", format="currency", editable=True),
            LineItemMeta(id="gross_rev", name="Gross Revenue", format="currency", editable=False),
            LineItemMeta(id="discounts", name="Discounts", format="currency", editable=True),
            LineItemMeta(id="net_rev", name="Net Revenue", format="currency", editable=False),
        ],
    ),
    ModuleMeta(
        id="expense",
        name="Expense Planning",
        dimension_ids=["time", "department", "cost_center", "account_code"],
        line_items=[
            LineItemMeta(id="cost_type", name="Cost Type", format="text", editable=True),
            LineItemMeta(id="manager_exp", name="Manager", format="text", editable=True),
            LineItemMeta(id="budget_amt", name="Budget Amount", format="currency", editable=True),
            LineItemMeta(id="actual_amt", name="Actual Amount", format="currency", editable=True),
            LineItemMeta(id="variance", name="Variance", format="currency", editable=False),
            LineItemMeta(id="var_pct", name="Variance %", format="percentage", editable=False),
        ],
    ),
    ModuleMeta(
        id="pnl",
        name="P&L Summary",
        dimension_ids=["time", "product"],
        line_items=[
            LineItemMeta(id="region_label", name="Region", format="text", editable=True),
            LineItemMeta(id="revenue", name="Revenue", format="currency", editable=False),
            LineItemMeta(id="cogs", name="COGS", format="currency", editable=True),
            LineItemMeta(id="gross_profit", name="Gross Profit", format="currency", editable=False),
            LineItemMeta(id="opex", name="OpEx", format="currency", editable=True),
            LineItemMeta(id="ebitda", name="EBITDA", format="currency", editable=False),
            LineItemMeta(id="net_income", name="Net Income", format="currency", editable=False),
        ],
    ),
]


def _cell_key(
    module_id: str,
    version: str,
    row_dims: list[str],
    line_item_id: str,
    time_id: str,
) -> str:
    return f"{module_id}|{version}|{','.join(row_dims)}|{line_item_id}|{time_id}"


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


class MockAdapter(EngineAdapter):
    def __init__(self) -> None:
        self._connected = False
        self._cells: dict[str, float] = {}
        self._text_cells: dict[str, str] = {}

    @property
    def id(self) -> str:
        return "mock"

    @property
    def name(self) -> str:
        return "Mock Planning Engine"

    @property
    def engine_type(self) -> str:
        return "mock"

    async def connect(self, config: dict[str, str] | None = None) -> None:
        self._connected = True
        self._seed_data()

    async def disconnect(self) -> None:
        self._connected = False
        self._cells.clear()
        self._text_cells.clear()

    def is_connected(self) -> bool:
        return self._connected

    async def get_workspaces(self) -> list[WorkspaceInfo]:
        return [
            WorkspaceInfo(id="demo", name="Demo Workspace"),
            WorkspaceInfo(id="sandbox", name="Sandbox"),
        ]

    async def get_schema(self, workspace_id: str) -> WorkspaceSchema:
        return WorkspaceSchema(
            dimensions=DIMENSIONS,
            modules=MODULES,
            versions=VERSIONS,
        )

    async def get_dimension_items(
        self,
        workspace_id: str,
        dimension_id: str,
        parent_filter: ParentFilter | None = None,
    ) -> list[DimensionItem]:
        items = DIM_ITEMS.get(dimension_id, [])
        if not parent_filter or not parent_filter.item_ids:
            return items
        return [
            item
            for item in items
            if item.parent_item_id and item.parent_item_id in parent_filter.item_ids
        ]

    async def get_line_item_values(
        self,
        workspace_id: str,
        module_id: str,
        line_item_id: str,
        version: str,
    ) -> list[str]:
        """Get distinct text values for a text line item."""
        prefix = f"{module_id}|{version}|"
        suffix = f"|{line_item_id}|"
        values: set[str] = set()
        for key, val in self._text_cells.items():
            if key.startswith(prefix) and suffix in key and val.strip():
                values.add(val)
        return sorted(values)

    async def get_module_data(
        self,
        workspace_id: str,
        module_id: str,
        request: ModuleDataRequest,
    ) -> ModuleDataResponse:
        mod = next((m for m in MODULES if m.id == module_id), None)
        if mod is None:
            raise ValueError(f"Module {module_id} not found")

        version = request.version or "actual"
        page = request.page
        page_size = request.page_size

        # Separate text and numeric line items
        text_line_items = [li for li in mod.line_items if li.format == "text"]
        numeric_line_items = [li for li in mod.line_items if li.format != "text"]

        # Row dimensions = everything except time
        row_dim_ids = [d for d in mod.dimension_ids if d != "time"]
        has_time = "time" in mod.dimension_ids
        time_items = (
            self._get_filtered_items("time", request.filters)
            if has_time
            else [DimensionItem(id="_", name="")]
        )

        # Apply line item ID filter to numeric items
        if request.line_item_id:
            numeric_line_items = [li for li in numeric_line_items if li.id == request.line_item_id]

        # Build row combinations
        dim_item_lists = [
            self._get_filtered_items(dim_id, request.filters) for dim_id in row_dim_ids
        ]
        row_combinations: list[list[tuple[str, DimensionItem]]] = []
        if dim_item_lists:
            for combo in cartesian_product(*dim_item_lists):
                row_combinations.append(
                    [(row_dim_ids[i], item) for i, item in enumerate(combo)]
                )
        else:
            row_combinations.append([])

        # Build column definitions
        columns: list[ColumnDef] = []
        for dim_id in row_dim_ids:
            dim = next((d for d in DIMENSIONS if d.id == dim_id), None)
            if dim:
                columns.append(ColumnDef(key=dim_id, label=dim.name, type="dimension"))

        # Text line item columns (no time pivot)
        for li in text_line_items:
            columns.append(
                ColumnDef(
                    key=li.id,
                    label=li.name,
                    type="value",
                    format="text",
                    editable=li.editable,
                    line_item_id=li.id,
                )
            )

        # Numeric line item columns (time-pivoted)
        for li in numeric_line_items:
            for tp in time_items:
                key = f"{li.id}__{tp.id}" if has_time else li.id
                label = f"{li.name} - {tp.name}" if has_time else li.name
                columns.append(
                    ColumnDef(
                        key=key,
                        label=label,
                        type="value",
                        format=li.format,
                        editable=li.editable,
                        line_item_id=li.id,
                        time_period_id=tp.id if has_time else None,
                    )
                )

        # Build rows
        all_rows: list[DataRow] = []
        for idx, combo in enumerate(row_combinations):
            row_dim_values = [c[1].id for c in combo]
            cells: dict[str, str | int | float | None] = {}

            for dim_id, item in combo:
                cells[dim_id] = item.name

            # Text line item values (use first time period key for text cells)
            first_tp = time_items[0] if time_items else DimensionItem(id="_", name="")
            for li in text_line_items:
                ck = _cell_key(module_id, version, row_dim_values, li.id, first_tp.id)
                cells[li.id] = self._text_cells.get(ck, "")

            # Numeric line item values
            for li in numeric_line_items:
                for tp in time_items:
                    key = f"{li.id}__{tp.id}" if has_time else li.id
                    ck = _cell_key(module_id, version, row_dim_values, li.id, tp.id)
                    cells[key] = self._cells.get(ck)

            all_rows.append(
                DataRow(id=f"row_{idx}_{'_'.join(row_dim_values)}", cells=cells)
            )

        # Apply line item text filters
        filtered = all_rows
        for li_id, selected_values in request.line_item_filters.items():
            if not selected_values:
                continue
            filtered = [
                row for row in filtered
                if row.cells.get(li_id) is not None and str(row.cells[li_id]) in selected_values
            ]

        # Apply numeric filters
        for nf in request.numeric_filters:
            # Find matching columns for this line item
            matching_cols = [
                c for c in columns
                if c.line_item_id == nf.line_item_id and c.type == "value" and c.format != "text"
            ]
            if not matching_cols:
                continue
            filtered = [
                row for row in filtered
                if any(
                    _apply_numeric_filter(
                        _to_float(row.cells.get(c.key)),
                        nf.operator,
                        nf.value,
                        nf.value_high,
                    )
                    for c in matching_cols
                )
            ]

        total_rows = len(filtered)
        start = (page - 1) * page_size
        rows = filtered[start : start + page_size]

        return ModuleDataResponse(
            columns=columns,
            rows=rows,
            page=page,
            page_size=page_size,
            total_rows=total_rows,
        )

    async def write_cells(
        self,
        workspace_id: str,
        module_id: str,
        version: str,
        cells: list[CellWrite],
    ) -> CellWriteResult:
        mod = next((m for m in MODULES if m.id == module_id), None)
        if mod is None:
            return CellWriteResult(success=False, errors=[f"Module {module_id} not found"])

        errors: list[str] = []

        for w in cells:
            parts = w.column_key.split("__") if "__" in w.column_key else [w.column_key, "_"]
            line_item_id, time_id = parts[0], parts[1]

            li = next((l for l in mod.line_items if l.id == line_item_id), None)
            if li is None:
                errors.append(f"Line item {line_item_id} not found")
                continue
            if not li.editable:
                errors.append(f"Line item {li.name} is not editable")
                continue

            # Extract row dimension values from row_id  (e.g. "row_0_electronics_us")
            row_dim_values = w.row_id.split("_", 2)[2].split("_") if "_" in w.row_id else []
            ck = _cell_key(module_id, version, row_dim_values, line_item_id, time_id)

            if li.format == "text":
                self._text_cells[ck] = str(w.value)
            else:
                self._cells[ck] = float(w.value)

        self._recalculate(module_id, version)

        if errors:
            return CellWriteResult(success=False, errors=errors)
        return CellWriteResult(success=True)

    # ── Internal helpers ──

    def _get_filtered_items(
        self,
        dim_id: str,
        filters: dict[str, list[str]],
    ) -> list[DimensionItem]:
        all_items = DIM_ITEMS.get(dim_id, [])
        selected = filters.get(dim_id)
        if selected:
            return [item for item in all_items if item.id in selected]

        dim = next((d for d in DIMENSIONS if d.id == dim_id), None)
        if dim and dim.parent_dimension_id:
            parent_selected = filters.get(dim.parent_dimension_id)
            if parent_selected:
                return [
                    item
                    for item in all_items
                    if item.parent_item_id and item.parent_item_id in parent_selected
                ]
        return all_items

    def _seed_data(self) -> None:
        rand = _seeded_random(42)

        for ver in VERSIONS:
            version_mult = (
                1.1 if ver.id == "budget" else 1.05 if ver.id == "forecast" else 1.0
            )

            # Revenue module
            base_by_product = {"electronics": 1.5, "apparel": 0.8, "home": 1.0}

            def revenue_fn(row_dims: list[str], li: str, _tp: str) -> float:
                mult = base_by_product.get(row_dims[0], 1)
                if li == "units":
                    return round(500 + rand() * 2000 * mult)
                elif li == "price":
                    return round((20 + rand() * 80 * mult) * 100) / 100
                return 0

            def revenue_text_fn(row_dims: list[str], li: str, _tp: str, r) -> str:
                idx = hash(tuple(row_dims)) % 100
                if li == "route":
                    return ROUTE_VALUES[idx % len(ROUTE_VALUES)]
                elif li == "manager":
                    return MANAGER_VALUES[idx % len(MANAGER_VALUES)]
                return ""

            self._seed_module("revenue", ver.id, version_mult, rand, revenue_fn)
            self._seed_text_items("revenue", ver.id, rand, revenue_text_fn)

            # Expense module
            def expense_fn(row_dims: list[str], li: str, _tp: str) -> float:
                if li == "budget_amt":
                    return round(10000 + rand() * 90000)
                elif li == "actual_amt":
                    return round(8000 + rand() * 85000)
                return 0

            def expense_text_fn(row_dims: list[str], li: str, _tp: str, r) -> str:
                idx = hash(tuple(row_dims)) % 100
                if li == "cost_type":
                    return COST_TYPE_VALUES[idx % len(COST_TYPE_VALUES)]
                elif li == "manager_exp":
                    return MANAGER_VALUES[idx % len(MANAGER_VALUES)]
                return ""

            self._seed_module("expense", ver.id, version_mult, rand, expense_fn)
            self._seed_text_items("expense", ver.id, rand, expense_text_fn)

            # P&L module
            def pnl_fn(row_dims: list[str], li: str, _tp: str) -> float:
                if li == "revenue":
                    return round(100000 + rand() * 500000)
                elif li == "cogs":
                    return round(40000 + rand() * 200000)
                elif li == "opex":
                    return round(20000 + rand() * 100000)
                return 0

            def pnl_text_fn(row_dims: list[str], li: str, _tp: str, r) -> str:
                idx = hash(tuple(row_dims)) % 100
                if li == "region_label":
                    return REGION_LABELS[idx % len(REGION_LABELS)]
                return ""

            self._seed_module("pnl", ver.id, version_mult, rand, pnl_fn)
            self._seed_text_items("pnl", ver.id, rand, pnl_text_fn)

        # Recalculate formulas
        for ver in VERSIONS:
            self._recalculate("revenue", ver.id)
            self._recalculate("expense", ver.id)
            self._recalculate("pnl", ver.id)

    def _seed_module(
        self,
        module_id: str,
        version: str,
        version_mult: float,
        rand,
        value_fn,
    ) -> None:
        mod = next(m for m in MODULES if m.id == module_id)
        row_dim_ids = [d for d in mod.dimension_ids if d != "time"]
        time_items = DIM_ITEMS["time"]

        dim_item_id_lists = [
            [item.id for item in DIM_ITEMS[dim_id]] for dim_id in row_dim_ids
        ]
        row_combos = list(cartesian_product(*dim_item_id_lists)) if dim_item_id_lists else [()]

        for row_dims_tuple in row_combos:
            row_dims = list(row_dims_tuple)
            for tp in time_items:
                for li in mod.line_items:
                    if li.format == "text" or not li.editable:
                        continue
                    val = value_fn(row_dims, li.id, tp.id)
                    ck = _cell_key(module_id, version, row_dims, li.id, tp.id)
                    self._cells[ck] = round(val * version_mult * 100) / 100

    def _seed_text_items(
        self,
        module_id: str,
        version: str,
        rand,
        text_fn,
    ) -> None:
        mod = next(m for m in MODULES if m.id == module_id)
        row_dim_ids = [d for d in mod.dimension_ids if d != "time"]
        time_items = DIM_ITEMS["time"]
        text_items = [li for li in mod.line_items if li.format == "text"]

        dim_item_id_lists = [
            [item.id for item in DIM_ITEMS[dim_id]] for dim_id in row_dim_ids
        ]
        row_combos = list(cartesian_product(*dim_item_id_lists)) if dim_item_id_lists else [()]

        for row_dims_tuple in row_combos:
            row_dims = list(row_dims_tuple)
            first_tp = time_items[0] if time_items else DimensionItem(id="_", name="")
            for li in text_items:
                val = text_fn(row_dims, li.id, first_tp.id, rand)
                ck = _cell_key(module_id, version, row_dims, li.id, first_tp.id)
                self._text_cells[ck] = val

    def _recalculate(self, module_id: str, version: str) -> None:
        mod = next(m for m in MODULES if m.id == module_id)
        row_dim_ids = [d for d in mod.dimension_ids if d != "time"]
        time_items = DIM_ITEMS["time"]

        dim_item_id_lists = [
            [item.id for item in DIM_ITEMS[dim_id]] for dim_id in row_dim_ids
        ]
        row_combos = list(cartesian_product(*dim_item_id_lists)) if dim_item_id_lists else [()]

        for row_dims_tuple in row_combos:
            row_dims = list(row_dims_tuple)
            for tp in time_items:

                def get(li_id: str) -> float:
                    return self._cells.get(
                        _cell_key(module_id, version, row_dims, li_id, tp.id), 0
                    )

                def put(li_id: str, val: float) -> None:
                    self._cells[
                        _cell_key(module_id, version, row_dims, li_id, tp.id)
                    ] = round(val * 100) / 100

                if module_id == "revenue":
                    units = get("units")
                    price = get("price")
                    discounts = get("discounts")
                    put("gross_rev", units * price)
                    put("net_rev", units * price - discounts)

                elif module_id == "expense":
                    budget_amt = get("budget_amt")
                    actual_amt = get("actual_amt")
                    put("variance", budget_amt - actual_amt)
                    put("var_pct", ((budget_amt - actual_amt) / budget_amt * 100) if budget_amt else 0)

                elif module_id == "pnl":
                    revenue = get("revenue")
                    cogs = get("cogs")
                    opex = get("opex")
                    put("gross_profit", revenue - cogs)
                    put("ebitda", revenue - cogs - opex)
                    put("net_income", (revenue - cogs - opex) * 0.75)


def _to_float(val: str | int | float | None) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
