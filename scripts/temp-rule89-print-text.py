import json, sys
d = json.load(sys.stdin)
print(d['result']['content'][0]['text'])
