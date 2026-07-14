import json, sys
sha = sys.argv[1]
body = {
    'jsonrpc': '2.0', 'id': 7, 'method': 'tools/call',
    'params': {
        'name': 'commit_file_patch',
        'arguments': {
            'path': 'docs/TEMP-commit-file-patch-test.md',
            'edits': [
                {'old_str': 'THIS_STRING_DOES_NOT_EXIST_ANYWHERE_XYZ', 'new_str': 'irrelevant'},
            ],
            'commit_message': 'temp: this should be rejected',
            'parent_sha': sha,
            'repo': 'field-relay-nba',
        },
    },
}
print(json.dumps(body))
