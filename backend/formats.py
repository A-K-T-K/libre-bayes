"""Import/export for standard Bayesian-network interchange formats.

BIF, NET, and XDSL are handled by pgmpy's own readers/writers (operating on
in-memory strings, no temp files needed). DSC has no pgmpy support, so it's
hand-rolled here as a small Hugin-NET-like text format.
"""

from __future__ import annotations

import re
import xml.dom.minidom as minidom
import xml.etree.ElementTree as ET

import numpy as np
from pgmpy.models import DiscreteBayesianNetwork
from pgmpy.readwrite import (
    BIFReader,
    BIFWriter,
    NETReader,
    NETWriter,
    XDSLReader,
    XDSLWriter,
)

from engine import EngineError, build_network
from schema import InferenceOptions, NetworkPayload, NodeDefinition

SUPPORTED_FORMATS = {"bif", "net", "xdsl", "dsc"}


def model_to_payload(model: DiscreteBayesianNetwork) -> NetworkPayload:
    nodes: list[NodeDefinition] = []
    for cpd in model.get_cpds():
        variable = cpd.variable
        states = [str(s) for s in cpd.state_names[variable]]
        parents = [v for v in cpd.variables if v != variable]
        values = np.asarray(cpd.get_values(), dtype=float)
        nodes.append(
            NodeDefinition(
                id=variable,
                states=states,
                cpt=values.tolist(),
                parents=parents,
            )
        )
    edges = [(u, v) for u, v in model.edges()]
    return NetworkPayload(
        nodes=nodes,
        edges=edges,
        evidence={},
        options=InferenceOptions(),
    )


def export_network(payload: NetworkPayload, fmt: str) -> str:
    if fmt == "dsc":
        return _write_dsc(payload)

    model = build_network(payload)
    if fmt == "bif":
        return str(BIFWriter(model))
    if fmt == "net":
        return str(NETWriter(model))
    if fmt == "xdsl":
        return _write_xdsl(model)
    raise EngineError(f"unsupported export format '{fmt}'")


def import_network(content: str, fmt: str) -> NetworkPayload:
    if fmt == "dsc":
        return _read_dsc(content)

    try:
        if fmt == "bif":
            model = BIFReader(string=content).get_model()
        elif fmt == "net":
            model = NETReader(string=content).get_model()
        elif fmt == "xdsl":
            model = XDSLReader(string=content).get_model()
        else:
            raise EngineError(f"unsupported import format '{fmt}'")
    except EngineError:
        raise
    except Exception as exc:  # noqa: BLE001 - malformed file from an external tool
        raise EngineError(f"could not parse {fmt.upper()} file: {exc}") from exc

    # pgmpy's readers don't always raise on genuinely malformed input -- BIFReader
    # in particular silently returns a valid-but-empty model for text that isn't
    # BIF at all, which would otherwise surface as a confusing blank canvas
    # instead of a clear error.
    if model is None or model.number_of_nodes() == 0:
        raise EngineError(f"could not parse {fmt.upper()} file: no nodes found -- is this really a {fmt.upper()} file?")
    return model_to_payload(model)


def _write_xdsl(model: DiscreteBayesianNetwork) -> str:
    writer = XDSLWriter(model)
    xml_bytes = ET.tostring(writer.root, encoding=writer.encoding)
    pretty = minidom.parseString(xml_bytes).toprettyxml(indent="    ", encoding=writer.encoding)
    return pretty.decode(writer.encoding)


# --- DSC ---------------------------------------------------------------
#
# A plain-text format structurally close to Hugin NET, using the
# conventional `belief network` / `node` / `probability` keywords:
#
#   belief network "Name"
#   node Cloudy {
#       type : discrete [2] = { "True", "False" };
#   }
#   probability ( Sprinkler | Cloudy ) {
#       0.1, 0.9,
#       0.5, 0.5;
#   }

_NODE_RE = re.compile(
    r'node\s+(\S+)\s*\{\s*type\s*:\s*discrete\s*\[\s*\d+\s*\]\s*=\s*\{([^}]*)\}\s*;\s*\}',
    re.MULTILINE,
)
_PROB_RE = re.compile(
    r'probability\s*\(\s*(\S+)\s*(?:\|\s*([^)]*))?\)\s*\{([^}]*)\}',
    re.MULTILINE,
)


def _write_dsc(payload: NetworkPayload) -> str:
    lines = ['belief network "Network"', ""]
    for node in payload.nodes:
        state_list = ", ".join(f'"{s}"' for s in node.states)
        lines.append(f"node {node.id} {{")
        lines.append(f"    type : discrete [{len(node.states)}] = {{ {state_list} }};")
        lines.append("}")
        lines.append("")

    for node in payload.nodes:
        header = f"probability ( {node.id}"
        if node.parents:
            header += " | " + ", ".join(node.parents)
        header += " ) {"
        lines.append(header)
        # column-major -> row-per-column so each line is one full
        # distribution over the node's own states, matching NET/DSC
        # convention (easiest to hand-edit and to re-parse).
        cols = len(node.cpt[0]) if node.cpt else 1
        for c in range(cols):
            row_values = ", ".join(f"{node.cpt[r][c]:.6f}" for r in range(len(node.states)))
            lines.append(f"    {row_values},")
        lines.append("}")
        lines.append("")

    return "\n".join(lines)


def _read_dsc(content: str) -> NetworkPayload:
    node_order: list[str] = []
    states_by_id: dict[str, list[str]] = {}
    for match in _NODE_RE.finditer(content):
        node_id = match.group(1)
        raw_states = match.group(2)
        states = [s.strip().strip('"') for s in raw_states.split(",") if s.strip()]
        if not states:
            raise EngineError(f"DSC node '{node_id}' declares no states")
        node_order.append(node_id)
        states_by_id[node_id] = states

    if not node_order:
        raise EngineError("DSC file has no node declarations")

    parents_by_id: dict[str, list[str]] = {}
    cpt_by_id: dict[str, list[list[float]]] = {}
    for match in _PROB_RE.finditer(content):
        node_id = match.group(1)
        if node_id not in states_by_id:
            raise EngineError(f"DSC probability table references unknown node '{node_id}'")
        raw_parents = match.group(2)
        parents = [p.strip() for p in raw_parents.split(",")] if raw_parents else []
        parents = [p for p in parents if p]
        parents_by_id[node_id] = parents

        body = match.group(3)
        numbers = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", body)]
        card = len(states_by_id[node_id])
        if len(numbers) % card != 0:
            raise EngineError(
                f"DSC probability table for '{node_id}' has {len(numbers)} values, "
                f"not a multiple of its {card} states"
            )
        cols = len(numbers) // card
        cpt = [[numbers[c * card + r] for c in range(cols)] for r in range(card)]
        cpt_by_id[node_id] = cpt

    nodes: list[NodeDefinition] = []
    for node_id in node_order:
        if node_id not in cpt_by_id:
            raise EngineError(f"DSC file has no probability table for node '{node_id}'")
        nodes.append(
            NodeDefinition(
                id=node_id,
                states=states_by_id[node_id],
                cpt=cpt_by_id[node_id],
                parents=parents_by_id.get(node_id, []),
            )
        )

    edges: list[tuple[str, str]] = []
    for node in nodes:
        for parent in node.parents:
            edges.append((parent, node.id))

    return NetworkPayload(nodes=nodes, edges=edges, evidence={}, options=InferenceOptions())
