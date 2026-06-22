## SESSION END (mandatory — runs after every task, before closing)

### A. Output verification (if briefs generated or modified)
SPOT=$(curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/briefs/spot-check?n=5")
VERDICT=$(echo $SPOT | python3 -c "import json,sys; print(json.load(sys.stdin).get('verdict','ERR'))")
if [ "$VERDICT" != "PASS" ] && [ "$VERDICT" != "no_briefs" ]; then
  echo "QUALITY FAIL — document in outbox, do NOT call /session/record with ok status"
  echo $SPOT | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d.get('results',[]):
    if not r['pass']:
        print(f'  FAIL: {r[\"id\"]} — {r[\"flagged_phrases\"]} {r[\"cross_sport\"]}')
        print(f'  Preview: {r[\"preview\"]}')"
fi

### B. Record session
curl -s -X POST https://field-relay-nba.jeffunglesbee.workers.dev/session/record \
  -H "Content-Type: application/json" \
  -d "{
    \"client_head\": \"$(cd ~/jubilant-bassoon && git rev-parse --short HEAD 2>/dev/null || echo unknown)\",
    \"relay_head\":  \"$(cd ~/field-relay-nba  && git rev-parse --short HEAD 2>/dev/null || echo unknown)\",
    \"session_type\": \"relay\",
    \"summary\": \"[REPLACE: one sentence describing what shipped]\",
    \"carry_forwards\": [\"[REPLACE: any items not completed]\"],
    \"drive_docs\": []
  }"

### C. write_handoff via MCP
# Use the anchor string returned by /session/record above.

### D. codex_write for each feature touched (3-5 entries minimum)
