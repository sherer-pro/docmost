"""Read-only corpus and graph checks for the installed Graphify toolchain."""

import argparse
import hashlib
import json
from pathlib import Path
import re

from graphify.detect import detect


def corpus(root):
    detected = detect(root)
    rows = []
    for kind, names in detected['files'].items():
        for name in names:
            file = Path(name).resolve()
            relative = file.relative_to(root).as_posix()
            if any(part in {'artifacts', 'node_modules', '.git', 'graphify-out', 'graphify-out.next', 'graphify-out.previous'} for part in Path(relative).parts):
                raise ValueError(f'Excluded source in corpus: {relative}')
            raw = file.read_bytes()
            rows.append({'path': relative, 'kind': kind, 'sha256': hashlib.sha256(raw).hexdigest(), 'md5': hashlib.md5(raw, usedforsecurity=False).hexdigest()})
    rows.sort(key=lambda row: row['path'])
    checksum = hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'sourceSha256': checksum, 'files': rows, 'counts': {kind: len(names) for kind, names in detected['files'].items()}}


def check(root, directory, snapshot):
    current = corpus(root)
    if current['sourceSha256'] != snapshot['sourceSha256']:
        raise ValueError('Source corpus changed during extraction')
    graph = json.loads((directory / 'graph.json').read_text(encoding='utf8'))
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf8'))
    rows = {row['path']: row for row in current['files']}
    manifest = {Path(name).relative_to(root).as_posix() if Path(name).is_absolute() else name.replace('\\', '/'): value for name, value in manifest.items()}
    missing = sorted(rows.keys() - manifest.keys())
    extra = sorted(manifest.keys() - rows.keys())
    stale = [name for name, value in manifest.items() if name in rows and value.get('ast_hash' if rows[name]['kind'] == 'code' else 'semantic_hash') != rows[name]['md5']]
    errors = []
    if missing or extra or stale:
        errors.append({'manifestMissing': missing, 'manifestExtra': extra, 'manifestStale': stale})
    nodes = graph['nodes']
    edges = graph.get('links', graph.get('edges', []))
    hypers = graph.get('hyperedges', [])
    ids = {json.dumps(node['id']) for node in nodes}
    if len(ids) != len(nodes):
        errors.append('Duplicate node IDs')
    dangling = [i for i, edge in enumerate(edges) if json.dumps(edge['source']) not in ids or json.dumps(edge['target']) not in ids]
    bad_hyper = [i for i, edge in enumerate(hypers) if any(json.dumps(node) not in ids for node in edge.get('nodes', []))]
    bad_sources = []
    bad_locations = []
    unverified_locations = 0
    checked_locations = 0
    line_counts = {}
    no_source = 0
    represented = set()
    for bucket, objects in [('nodes', nodes), ('edges', edges), ('hyperedges', hypers)]:
        for i, item in enumerate(objects):
            source = item.get('source_file')
            if not source:
                no_source += 1
                continue
            file = Path(source)
            relative = file.relative_to(root).as_posix() if file.is_absolute() and file.is_relative_to(root) else str(source).replace('\\', '/').removeprefix('./')
            if relative not in rows:
                bad_sources.append({'kind': bucket, 'index': i, 'source': source})
            elif bucket == 'nodes':
                represented.add(relative)
            location = item.get('source_location')
            if relative in rows and isinstance(location, str):
                match = re.fullmatch(r'L(\d+)(?:-L?(\d+))?', location)
                if match:
                    if relative not in line_counts:
                        line_counts[relative] = len((root / relative).read_text(encoding='utf8', errors='replace').splitlines())
                    first = int(match[1])
                    last = int(match[2] or first)
                    if first < 1 or last < first or last > line_counts[relative]:
                        bad_locations.append({'kind': bucket, 'index': i, 'source': relative, 'location': location})
                    else:
                        checked_locations += 1
                else:
                    unverified_locations += 1
            else:
                unverified_locations += 1
    if dangling or bad_hyper or bad_sources:
        errors.append({'danglingEdges': dangling, 'danglingHyperedges': bad_hyper, 'invalidSources': bad_sources})
    if bad_locations:
        errors.append({'invalidSourceLocations': bad_locations})
    result = {'ok': not errors, 'sourceSha256': current['sourceSha256'], 'nodes': len(nodes), 'edges': len(edges), 'hyperedges': len(hypers), 'files': len(rows), 'filesWithNodes': len(represented), 'filesWithoutNodes': sorted(rows.keys() - represented), 'objectsWithoutSource': no_source, 'checkedLineLocations': checked_locations, 'unverifiedLocations': unverified_locations, 'unverifiedNodes': sum(node.get('verification') == 'unverified' for node in nodes), 'errors': errors}
    (directory / 'integrity.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf8')
    if errors:
        raise ValueError('Graph integrity failed; inspect staging integrity.json')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['corpus', 'check'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--directory', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    result = corpus(root) if args.command == 'corpus' else check(root, args.directory, json.loads((args.directory / 'input-snapshot.json').read_text(encoding='utf8')))
    print(json.dumps(result, ensure_ascii=True))
