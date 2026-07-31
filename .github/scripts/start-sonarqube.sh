#!/usr/bin/env bash
set -euo pipefail

readonly SONAR_URL="http://127.0.0.1:9000"
readonly CONTAINER_NAME="sonarqube-ci"
readonly IMAGE="sonarqube:26.7.0.124771-community"

sudo sysctl -w vm.max_map_count=524288
sudo sysctl -w fs.file-max=131072

docker run --detach \
  --name "${CONTAINER_NAME}" \
  --publish 127.0.0.1:9000:9000 \
  --env SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
  "${IMAGE}"

for attempt in {1..90}; do
  status="$(curl --silent --show-error --fail "${SONAR_URL}/api/system/status" 2>/dev/null | jq --raw-output '.status // empty' || true)"
  if [[ "${status}" == "UP" ]]; then
    break
  fi

  if [[ "${attempt}" -eq 90 ]]; then
    docker logs "${CONTAINER_NAME}"
    echo "SonarQube did not become ready within 9 minutes." >&2
    exit 1
  fi
  sleep 6
done

# The instance is bound to localhost and exists only for this runner job. We still
# replace the default password before creating a short-lived analysis token.
# SonarQube local passwords must remain within its accepted length. A 16-byte
# random value encoded as 32 hexadecimal characters provides 128 bits of entropy.
admin_password="$(openssl rand -hex 16)"
echo "::add-mask::${admin_password}"

if ! password_response="$(curl --silent --show-error --fail-with-body \
  --user admin:admin \
  --request POST \
  --data-urlencode login=admin \
  --data-urlencode previousPassword=admin \
  --data-urlencode "password=${admin_password}" \
  "${SONAR_URL}/api/users/change_password")"; then
  echo "SonarQube rejected the temporary administrator password." >&2
  echo "${password_response}" >&2
  exit 1
fi

token_name="github-actions-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
token_response="$(curl --silent --show-error --fail-with-body \
  --user "admin:${admin_password}" \
  --request POST \
  --data-urlencode "name=${token_name}" \
  "${SONAR_URL}/api/user_tokens/generate")"
sonar_token="$(jq --raw-output '.token // empty' <<<"${token_response}")"

if [[ -z "${sonar_token}" ]]; then
  echo "SonarQube did not return an analysis token." >&2
  exit 1
fi

echo "::add-mask::${sonar_token}"
echo "SONAR_HOST_URL=${SONAR_URL}" >>"${GITHUB_ENV}"
echo "SONAR_TOKEN=${sonar_token}" >>"${GITHUB_ENV}"

echo "SonarQube Community Build is ready at ${SONAR_URL}."
