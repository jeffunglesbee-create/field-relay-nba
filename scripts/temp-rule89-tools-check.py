import json, sys
d = json.load(sys.stdin)
tools = {t['name']: t for t in d['result']['tools']}
for name in ['get_ci_status', 'get_deploy_status', 'commit_file_patch']:
    t = tools.get(name)
    print(f'--- {name} ---')
    if not t:
        print('MISSING')
        continue
    print('description:', t['description'][:200])
    print('required:', t['inputSchema'].get('required'))
