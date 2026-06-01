#!/usr/bin/env bash
# Full workflow API smoke test for Print Partner web (self-host).
# Usage: BASE=http://localhost:8080 ./web/scripts/workflow-smoke.sh
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SOURCE_URL="${SOURCE_URL:-https://github.com/Klipper3d/klipper}"
SOURCE_BRANCH="${SOURCE_BRANCH:-master}"
PLAN_NAME="${PLAN_NAME:-smoke-test-plan-$(date +%s)}"

body_only() { sed '$d'; }
http_code() { tail -1 | sed 's/HTTP://'; }

wait_job() {
  local job_id=$1
  local i status
  for i in $(seq 1 90); do
    status=$(curl -s "$BASE/jobs/$job_id" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
    echo "    job $job_id: $status"
    case "$status" in
      done|error|cancelled) curl -s "$BASE/jobs/$job_id" | python3 -m json.tool | head -20
        return 0 ;;
    esac
    sleep 2
  done
  echo "    job timed out"
  return 1
}

echo "== 0. GET /health =="
curl -s -w "\nHTTP:%{http_code}\n" "$BASE/health" | tee /tmp/pp-smoke-health.txt
grep -q '"ok":true' /tmp/pp-smoke-health.txt

echo "== 1. POST /sources =="
SRC_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X POST "$BASE/sources" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Source\",\"url\":\"$SOURCE_URL\",\"branch\":\"$SOURCE_BRANCH\",\"source_kind\":\"github\"}")
echo "$SRC_RESP" | body_only
echo "HTTP:$(echo "$SRC_RESP" | http_code)"
SOURCE_ID=$(echo "$SRC_RESP" | body_only | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "== 2. POST /jobs/sync =="
SYNC_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X POST "$BASE/jobs/sync" \
  -H 'Content-Type: application/json' \
  -d "{\"project_id\": $SOURCE_ID}")
echo "$SYNC_RESP" | body_only
echo "HTTP:$(echo "$SYNC_RESP" | http_code)"
SYNC_JOB=$(echo "$SYNC_RESP" | body_only | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
wait_job "$SYNC_JOB"

echo "== 3. POST /plans =="
PLAN_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X POST "$BASE/plans" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$PLAN_NAME\"}")
echo "$PLAN_RESP" | body_only
echo "HTTP:$(echo "$PLAN_RESP" | http_code)"
PLAN_ID=$(echo "$PLAN_RESP" | body_only | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "== 4. PUT /plans/$PLAN_ID/layers/base =="
LAYER_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X PUT "$BASE/plans/$PLAN_ID/layers/base" \
  -H 'Content-Type: application/json' \
  -d "{\"project_id\": $SOURCE_ID}")
echo "$LAYER_RESP" | body_only
echo "HTTP:$(echo "$LAYER_RESP" | http_code)"

echo "== 5. POST /jobs/recompute =="
REC_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X POST "$BASE/jobs/recompute" \
  -H 'Content-Type: application/json' \
  -d "{\"profile_id\": $PLAN_ID, \"apply_manifest\": false}")
echo "$REC_RESP" | body_only
echo "HTTP:$(echo "$REC_RESP" | http_code)"
REC_JOB=$(echo "$REC_RESP" | body_only | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
wait_job "$REC_JOB"

echo "== 6. GET /plans/$PLAN_ID/parts =="
PARTS_RESP=$(curl -s -w "\nHTTP:%{http_code}" "$BASE/plans/$PLAN_ID/parts?limit=3")
echo "$PARTS_RESP" | body_only | python3 -m json.tool
echo "HTTP:$(echo "$PARTS_RESP" | http_code)"

echo "== 7. GET /plans/$PLAN_ID/checkoff =="
CHECK_RESP=$(curl -s -w "\nHTTP:%{http_code}" "$BASE/plans/$PLAN_ID/checkoff")
echo "$CHECK_RESP" | body_only | python3 -m json.tool | head -25
echo "HTTP:$(echo "$CHECK_RESP" | http_code)"

echo "== 8. PATCH /parts/{id}/progress =="
PART_ID=$(echo "$PARTS_RESP" | body_only | python3 -c "import sys,json; p=json.load(sys.stdin)['parts']; print(p[0]['id'] if p else '')")
if [[ -n "$PART_ID" ]]; then
  PROG_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X PATCH "$BASE/parts/$PART_ID/progress" \
    -H 'Content-Type: application/json' \
    -d '{"unit_index":0,"completed":true}')
  echo "$PROG_RESP" | body_only
  echo "HTTP:$(echo "$PROG_RESP" | http_code)"
else
  echo "SKIP (no parts)"
fi

echo "== 9. POST /jobs/export-stl-pack =="
EXP_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X POST "$BASE/jobs/export-stl-pack" \
  -H 'Content-Type: application/json' \
  -d "{\"profile_id\": $PLAN_ID}")
echo "$EXP_RESP" | body_only
echo "HTTP:$(echo "$EXP_RESP" | http_code)"
EXP_JOB=$(echo "$EXP_RESP" | body_only | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
wait_job "$EXP_JOB"

echo "== 10. Static assets =="
curl -s -o /dev/null -w "GET / HTTP:%{http_code}\n" "$BASE/"
curl -s "$BASE/" | grep -oE 'assets/[^"]+' | head -3 | while read -r p; do
  curl -s -o /dev/null -w "GET /$p HTTP:%{http_code}\n" "$BASE/$p"
done

echo "Smoke workflow complete."
