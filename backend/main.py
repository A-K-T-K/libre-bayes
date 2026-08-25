"""FastAPI application exposing the Bayesian Network inference API."""

from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ValidationError

from custom_solver_loader import register_custom_solver
from engine import EngineError, available_solvers, run_inference, run_map_query, run_temporal_inference
from formats import SUPPORTED_FORMATS, export_network, import_network
from pgmpy_features import learn_parameters, learn_structure, query_independence, query_markov_blanket, simulate
from schema import (
    CustomSolverRequest,
    IndependenceRequest,
    IndependenceResponse,
    InferenceResponse,
    LearnParametersRequest,
    LearnParametersResponse,
    MapQueryResponse,
    MarkovBlanketRequest,
    MarkovBlanketResponse,
    NetworkPayload,
    SimulateRequest,
    SimulateResponse,
    SolverDescriptor,
    StructureLearnRequest,
    StructureLearnResponse,
    TemporalInferenceResponse,
)

logger = logging.getLogger("bayes.api")

app = FastAPI(
    title="Bayesian Network Inference API",
    description="Modular multi-solver inference backend for the Bayesian Network Studio.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"status": "ok", "solvers": [s.name for s in available_solvers()]}


@app.get("/api/solvers", response_model=list[SolverDescriptor])
def solvers() -> list[SolverDescriptor]:
    """Every currently-registered inference solver, including any dropped
    into `backend/solvers/` as a plugin -- this is what the frontend's
    algorithm picker renders, so a new solver needs no frontend changes."""
    return [
        SolverDescriptor(
            name=s.name,
            label=s.label,
            description=s.description,
            supports_sampling=s.supports_sampling,
        )
        for s in available_solvers()
    ]


@app.post("/api/solvers/custom", response_model=list[SolverDescriptor])
async def add_custom_solver(body: CustomSolverRequest) -> list[SolverDescriptor]:
    """Registers a user-authored solver (see solvers/SCHEMA.md), persists it
    as a real plugin file, and returns the updated solver list."""
    try:
        await asyncio.to_thread(
            register_custom_solver, body.name, body.label, body.description, body.code
        )
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("custom solver registration failed")
        raise HTTPException(status_code=500, detail=f"registration failed: {exc}") from exc
    return [
        SolverDescriptor(
            name=s.name, label=s.label, description=s.description, supports_sampling=s.supports_sampling
        )
        for s in available_solvers()
    ]


@app.post("/api/infer", response_model=InferenceResponse)
async def infer(payload: NetworkPayload) -> InferenceResponse:
    try:
        # pgmpy's solvers are synchronous/CPU-bound; running them directly in
        # the route would block the whole event loop (including unrelated
        # requests like /api/health) for the duration of the computation.
        # Offload to a worker thread so the server stays responsive.
        return await asyncio.to_thread(run_inference, payload)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface solver failures to the client
        logger.exception("inference failed")
        raise HTTPException(status_code=500, detail=f"inference failed: {exc}") from exc


@app.post("/api/infer/map", response_model=MapQueryResponse)
async def infer_map(payload: NetworkPayload) -> MapQueryResponse:
    """Most probable full explanation (MAP): the single highest-probability
    joint assignment over the non-evidence nodes, always exact (VE)."""
    try:
        return await asyncio.to_thread(run_map_query, payload)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("MAP query failed")
        raise HTTPException(status_code=500, detail=f"MAP query failed: {exc}") from exc


@app.post("/api/infer/temporal", response_model=TemporalInferenceResponse)
async def infer_temporal(payload: NetworkPayload) -> TemporalInferenceResponse:
    """Every node's marginal at every unrolled time slice, for a network
    with at least one temporal node. Always exact (Variable Elimination)."""
    try:
        return await asyncio.to_thread(run_temporal_inference, payload)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("temporal inference failed")
        raise HTTPException(status_code=500, detail=f"temporal inference failed: {exc}") from exc


@app.post("/api/learn/parameters", response_model=LearnParametersResponse)
async def learn_parameters_route(body: LearnParametersRequest) -> LearnParametersResponse:
    try:
        return await asyncio.to_thread(learn_parameters, body)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("parameter learning failed")
        raise HTTPException(status_code=500, detail=f"parameter learning failed: {exc}") from exc


@app.post("/api/structure/learn", response_model=StructureLearnResponse)
async def learn_structure_route(body: StructureLearnRequest) -> StructureLearnResponse:
    try:
        return await asyncio.to_thread(learn_structure, body)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("structure learning failed")
        raise HTTPException(status_code=500, detail=f"structure learning failed: {exc}") from exc


@app.post("/api/explain/independence", response_model=IndependenceResponse)
async def independence_route(body: IndependenceRequest) -> IndependenceResponse:
    try:
        return await asyncio.to_thread(query_independence, body)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("independence query failed")
        raise HTTPException(status_code=500, detail=f"independence query failed: {exc}") from exc


@app.post("/api/explain/markov-blanket", response_model=MarkovBlanketResponse)
async def markov_blanket_route(body: MarkovBlanketRequest) -> MarkovBlanketResponse:
    try:
        return await asyncio.to_thread(query_markov_blanket, body)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("markov blanket query failed")
        raise HTTPException(status_code=500, detail=f"markov blanket query failed: {exc}") from exc


@app.post("/api/simulate", response_model=SimulateResponse)
async def simulate_route(body: SimulateRequest) -> SimulateResponse:
    try:
        return await asyncio.to_thread(simulate, body)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("simulation failed")
        raise HTTPException(status_code=500, detail=f"simulation failed: {exc}") from exc


class ImportRequest(BaseModel):
    content: str


def _validate_format(fmt: str) -> str:
    normalized = fmt.lower()
    if normalized not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"unsupported format '{fmt}' (expected one of {sorted(SUPPORTED_FORMATS)})",
        )
    return normalized


@app.post("/api/export/{fmt}", response_class=PlainTextResponse)
async def export_file(fmt: str, payload: NetworkPayload) -> str:
    normalized = _validate_format(fmt)
    try:
        return await asyncio.to_thread(export_network, payload, normalized)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("export failed")
        raise HTTPException(status_code=500, detail=f"export failed: {exc}") from exc


@app.post("/api/import/{fmt}", response_model=NetworkPayload)
async def import_file(fmt: str, body: ImportRequest) -> NetworkPayload:
    normalized = _validate_format(fmt)
    try:
        return await asyncio.to_thread(import_network, body.content, normalized)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("import failed")
        raise HTTPException(status_code=500, detail=f"import failed: {exc}") from exc
