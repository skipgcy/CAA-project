#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_KEY="bmazon-capstone"
readonly RESULT_FILE="sonarqube-result.json"

gate_json="$(curl --silent --show-error --fail \
  --user "${SONAR_TOKEN}:" \
  "${SONAR_HOST_URL}/api/qualitygates/project_status?projectKey=${PROJECT_KEY}")"
issues_json="$(curl --silent --show-error --fail \
  --user "${SONAR_TOKEN}:" \
  "${SONAR_HOST_URL}/api/issues/search?componentKeys=${PROJECT_KEY}&resolved=false&ps=1")"

jq --null-input \
  --arg status "$(jq --raw-output '.projectStatus.status' <<<"${gate_json}")" \
  --argjson openIssues "$(jq '.total' <<<"${issues_json}")" \
  '{qualityGate: $status, openIssues: $openIssues}' | tee "${RESULT_FILE}"

{
  echo "### SonarQube Community Build"
  echo
  echo "- Quality Gate: **$(jq --raw-output '.projectStatus.status' <<<"${gate_json}")**"
  echo "- Open issues: **$(jq '.total' <<<"${issues_json}")**"
  echo "- Server: isolated Community Build container on the GitHub-hosted runner"
} >>"${GITHUB_STEP_SUMMARY}"
