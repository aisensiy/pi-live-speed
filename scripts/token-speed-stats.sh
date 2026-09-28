#!/usr/bin/env bash
# 汇总 token-speed.jsonl：按模型看速度分布，并列出最近 10 次
LOG="${1:-$HOME/.pi/agent/token-speed.jsonl}"
[ -f "$LOG" ] || { echo "没有日志：$LOG"; exit 1; }

echo "=== 按模型汇总 ==="
jq -rs '
  group_by(.provider + "/" + .model)
  | map({
      model: .[0].provider + "/" + .[0].model,
      runs: length,
      ttft_avg: ((map(.ttftSec // 0) | add / length) * 100 | round / 100),
      tps_avg: ((map(.tps) | add / length) * 10 | round / 10),
      tps_min: (map(.tps) | min),
      tps_max: (map(.tps) | max),
      out_avg: ((map(.outputTokens) | add / length) | round)
    })
  | sort_by(-.runs)
  | (["模型","次数","首字均值s","吞吐均值","吞吐最低","吞吐最高","输出均值"]
     | @tsv),
    (.[] | [.model, .runs, .ttft_avg, .tps_avg, .tps_min, .tps_max, .out_avg] | @tsv)
' "$LOG" | column -t -s $'\t'

echo
echo "=== 最近 10 次 ==="
tail -10 "$LOG" | jq -r '[.ts, .model, .ttftSec, .genSec, .outputTokens, .tps, .stopReason] | @tsv' \
  | awk -F'\t' 'BEGIN{print "时间\t模型\t首字s\t生成s\ttoken\t吞吐\t结束原因"} {cmd="date -d @" int($1/1000) " +%H:%M:%S"; cmd | getline t; close(cmd); $1=t; print}' \
  | column -t -s $'\t'
