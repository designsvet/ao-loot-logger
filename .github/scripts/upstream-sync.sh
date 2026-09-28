#!/usr/bin/env bash
# Upstream watch — see .github/workflows/upstream-sync.yml for why this exists.
#
# Run from a clone of this repository with full history. Needs git, gh (GH_TOKEN) and node/npm.
# DRY_RUN=1 prints what it would write to GitHub instead of writing it.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-designsvet/ao-loot-logger}"
UPSTREAM_REPO="${UPSTREAM_REPO:-madvac/ao-loot-logger}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
BASE="${BASE:-protocol18}"
UPSTREAM_OWNER="${UPSTREAM_REPO%%/*}"
# Overridable so the script can be exercised against a local fake upstream.
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/$UPSTREAM_REPO.git}"
MARK="upstream-sync:tested"

write() {
  if [ -n "${DRY_RUN:-}" ]; then
    printf 'DRY_RUN would run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

git fetch --no-tags --quiet "$UPSTREAM_URL" "+refs/heads/$UPSTREAM_BRANCH:refs/remotes/upstream/$UPSTREAM_BRANCH"
git fetch --no-tags --quiet origin "+refs/heads/$BASE:refs/remotes/origin/$BASE"
up=$(git rev-parse "refs/remotes/upstream/$UPSTREAM_BRANCH")
base=$(git rev-parse "refs/remotes/origin/$BASE")

# Reviewed = reachable from BASE. Taking a commit, and declining it with `git merge -s ours`, both
# make it reachable — so a decline is recorded in history, where the next reviewer will see it.
if git merge-base --is-ancestor "$up" "$base"; then
  echo "Nothing to review: $UPSTREAM_REPO@$UPSTREAM_BRANCH (${up:0:7}) is already in $BASE."
  exit 0
fi

# The PR's head IS the upstream branch (head = madvac:main), so it follows every push he makes and
# nothing of his is copied into this repository. That is also the only shape that works: a
# workflow's own token may not push commits that change workflow files, and his do.
prs=$(gh pr list -R "$REPO" --base "$BASE" --state all --limit 100 \
  --json number,state,headRefName,headRepositoryOwner,headRefOid,mergedAt,body)
ours=$(jq --arg owner "$UPSTREAM_OWNER" --arg branch "$UPSTREAM_BRANCH" \
  '[.[] | select(.headRepositoryOwner.login == $owner and .headRefName == $branch)]' <<<"$prs")
open_pr=$(jq -r '[.[] | select(.state == "OPEN")][0].number // empty' <<<"$ours")
declined=$(jq -r --arg up "$up" '[.[] | select(.state == "CLOSED" and .mergedAt == null and .headRefOid == $up)] | length' <<<"$ours")

if [ -z "$open_pr" ] && [ "$declined" != "0" ]; then
  echo "A PR for exactly ${up:0:7} was closed without merging — treated as declined until upstream moves."
  echo "(To record the decline in history instead: git merge -s ours $UPSTREAM_OWNER/$UPSTREAM_BRANCH into $BASE.)"
  exit 0
fi

if [ -n "$open_pr" ]; then
  tested=$(jq -r --arg n "$open_pr" --arg mark "$MARK" \
    '.[] | select((.number | tostring) == $n) | .body // "" | capture("<!-- " + $mark + "=(?<sha>[0-9a-f]{40}) -->").sha // empty' <<<"$ours")
  if [ "$tested" = "$up" ]; then
    echo "PR #$open_pr already reports on ${up:0:7}."
    exit 0
  fi
fi

count=$(git rev-list --count "$base..$up")
commits=$(git log --no-merges --date=short \
  --format="- [\`%h\`](https://github.com/$UPSTREAM_REPO/commit/%H) %s — %ad" "$base..$up")

# The trial merge: exactly what merging this PR would produce, tested before anyone clicks.
git checkout --quiet --detach "$base"
if git -c user.name=upstream-sync -c user.email=upstream-sync@users.noreply.github.com \
  merge --no-ff --no-edit "$up" >/dev/null 2>&1; then
  if ! npm ci --ignore-scripts --no-audit --no-fund >/dev/null 2>&1; then
    npm install --ignore-scripts --no-audit --no-fund >/dev/null 2>&1
  fi
  if npm test >test.log 2>&1; then
    result="✅ Merges cleanly into \`$BASE\`, and the tests pass."
  else
    result="❌ Merges cleanly into \`$BASE\`, but the tests FAIL."
  fi
  totals=$(grep -E '^# (tests|pass|fail) ' test.log | sed 's/^# //' | paste -sd ' ' - || true)
  failing=$(grep -E '^not ok ' test.log | head -20 | sed 's/^/    /' || true)
  detail="Tests on the merged tree: ${totals:-no summary}"
  if [ -n "$failing" ]; then
    detail="$detail"$'\n\n'"$failing"
  fi
  git reset --quiet --hard "$base"
else
  conflicts=$(git diff --name-only --diff-filter=U | sed 's/^/- `/; s/$/`/')
  git merge --abort
  result="⚠️ Conflicts with \`$BASE\`, so the tests could not run on the merge."
  detail="Conflicting files:"$'\n'"$conflicts"
fi

body=$(cat <<EOF
$UPSTREAM_REPO has $count commit(s) on \`$UPSTREAM_BRANCH\` that \`$BASE\` has not reviewed.

**$result**

$detail

$commits

**Review, then pick one.** Nothing here merges on its own: this fork deliberately differs from upstream (\`src/items.js\`, the bundled item table, the local patches).
- **Take it:** merge this PR, or merge locally and resolve conflicts: \`git fetch https://github.com/$UPSTREAM_REPO.git $UPSTREAM_BRANCH && git merge FETCH_HEAD\` on \`$BASE\`.
- **Decline it, recorded:** \`git merge -s ours FETCH_HEAD\` on \`$BASE\`, with the reason in the message. Our code stays as it is, and the commits count as reviewed.
- Closing this PR without merging declines only these exact commits, and the next upstream push opens it again.

Opened by \`.github/workflows/upstream-sync.yml\` (on \`main\`), which checks daily.

<!-- $MARK=$up -->
EOF
)

title="Review upstream: $count new commit(s) on $UPSTREAM_REPO@$UPSTREAM_BRANCH"

if [ -n "$open_pr" ]; then
  write gh pr edit "$open_pr" -R "$REPO" --title "$title" --body "$body"
  write gh pr comment "$open_pr" -R "$REPO" --body "Upstream moved to \`${up:0:7}\` ($count unreviewed). $result"
else
  write gh pr create -R "$REPO" --base "$BASE" --head "$UPSTREAM_OWNER:$UPSTREAM_BRANCH" --title "$title" --body "$body"
fi

if [ -n "${DRY_RUN:-}" ]; then
  printf '\n----- body -----\n%s\n' "$body"
fi
