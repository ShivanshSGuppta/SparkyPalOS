#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository; skipping secret scan."
  exit 0
fi

if [[ -z "$(git diff --cached --name-only)" ]]; then
  exit 0
fi

PATTERN='(OPENAI_API_KEY\s*=\s*["'\'']?[A-Za-z0-9._-]{16,}|LLM_API_KEY\s*=\s*["'\'']?[A-Za-z0-9._-]{16,}|GEMINI_API_KEY\s*=\s*["'\'']?[A-Za-z0-9._-]{16,}|AUTH_TOKEN\s*=\s*["'\'']?[A-Za-z0-9._-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----)'

STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR | rg -v '^(tests/|.*\\.example$|.*\\.md$)' || true)"

if [[ -n "$STAGED_FILES" ]]; then
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if git show ":$file" | rg -n --pcre2 "$PATTERN" >/tmp/sparkypal-secret-scan.out; then
      echo "Secret scan failed in $file:"
      cat /tmp/sparkypal-secret-scan.out
      echo ""
      echo "Fix or remove those lines, then commit/push again."
      rm -f /tmp/sparkypal-secret-scan.out
      exit 1
    fi
  done <<< "$STAGED_FILES"
fi

rm -f /tmp/sparkypal-secret-scan.out
exit 0
