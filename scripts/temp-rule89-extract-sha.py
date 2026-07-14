import json, sys
d = json.load(sys.stdin)
t = json.loads(d['result']['content'][0]['text'])
print(t['sha'])
