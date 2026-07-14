import json, sys
sha = sys.argv[1]
body = {
    'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call',
    'params': {
        'name': 'commit_file_patch',
        'arguments': {
            'path': 'docs/TEMP-commit-file-patch-test.md',
            'edits': [
                {'old_str': 'MARKER_ONE: unchanged sentinel value alpha.', 'new_str': 'MARKER_ONE: CHANGED sentinel value alpha-prime.'},
                {'old_str': 'MARKER_TWO: unchanged sentinel value beta.', 'new_str': 'MARKER_TWO: CHANGED sentinel value beta-prime.'},
            ],
            'commit_message': 'temp: commit_file_patch live verification edit',
            'parent_sha': sha,
            'repo': 'field-relay-nba',
        },
    },
}
print(json.dumps(body))
