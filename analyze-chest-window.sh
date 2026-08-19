#!/bin/sh
# Local patch: reads the chest-window dumps and answers ONE question —
# did anything the client received name a player during chest activity?
# Usage: ./analyze-chest-window.sh [name ...]   (names of who looted, optional)
cd "$(dirname "$0")" || exit 1

echo "chest-window events captured: $(grep -c CHEST_WINDOW_EVENT debug-logs.txt)"
echo
echo "=== every STRING value seen in those dumps (a looter's name would be here) ==="
grep -A 6 "CHEST_WINDOW_EVENT" debug-logs.txt \
  | grep -oE "'[0-9]+': '[^']{3,}'" \
  | sed "s/.*: //" | sort | uniq -c | sort -rn | head -40
echo
if [ $# -gt 0 ]; then
  echo "=== searching for the names you gave ==="
  for n in "$@"; do
    printf "%-20s %s hits\n" "$n" "$(grep -c "$n" debug-logs.txt)"
    grep -B 3 -A 8 "$n" debug-logs.txt | grep -A 8 "CHEST_WINDOW_EVENT" | head -12
  done
fi
