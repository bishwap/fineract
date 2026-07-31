#!/usr/bin/env bash
#
# trigger-fd-500.sh — fire the seeded Fixed Deposit failure against a running
# Fineract instance so it surfaces as an HTTP 500 (which Dynatrace then detects).
#
# It creates the minimal prerequisites (a client + a fixed-deposit product) and
# then submits a fixed-deposit application, which hits the seeded defect in
# DepositApplicationProcessWritePlatformServiceJpaRepositoryImpl.submitFDApplication
# and returns HTTP 500.
#
# Usage:
#   ./trigger-fd-500.sh                 # uses defaults below
#   BASE_URL=https://host:8443 ./trigger-fd-500.sh
#   COUNT=5 ./trigger-fd-500.sh         # submit 5 times (to raise the failure rate)
#
# Env vars (all optional):
#   BASE_URL  Fineract base URL           (default https://localhost:8443)
#   TENANT    Fineract tenant identifier  (default default)
#   ADMIN_USER  admin username            (default mifos)
#   ADMIN_PASS  admin password            (default password)
#   COUNT       how many FD submissions   (default 1)

set -uo pipefail

BASE_URL="${BASE_URL:-https://localhost:8443}"
TENANT="${TENANT:-default}"
ADMIN_USER="${ADMIN_USER:-mifos}"
ADMIN_PASS="${ADMIN_PASS:-password}"
COUNT="${COUNT:-1}"

B="$BASE_URL/fineract-provider/api/v1"
A=(-sk -u "$ADMIN_USER:$ADMIN_PASS" -H "Fineract-Platform-TenantId: $TENANT" -H "Content-Type: application/json")

json_num() { grep -o "\"$1\":[0-9]*" | grep -o '[0-9]*' | head -1; }

echo "==> Ensuring USD currency is enabled"
curl "${A[@]}" -X PUT "$B/currencies" -d '{"currencies":["USD"]}' >/dev/null

echo "==> Creating client"
CLIENT=$(curl "${A[@]}" -X POST "$B/clients" -d '{
  "officeId":1,"legalFormId":1,"firstname":"Demo","lastname":"Client",
  "active":true,"activationDate":"01 January 2024","dateFormat":"dd MMMM yyyy","locale":"en"
}')
CLIENT_ID=$(echo "$CLIENT" | json_num clientId)
[ -z "$CLIENT_ID" ] && CLIENT_ID=$(echo "$CLIENT" | json_num resourceId)
echo "    clientId=$CLIENT_ID"

echo "==> Creating fixed-deposit product"
PROD=$(curl "${A[@]}" -X POST "$B/fixeddepositproducts" -d '{
  "name":"Demo FD Product '"$RANDOM"'","shortName":"D'"$((RANDOM%900+100))"'","description":"demo fd",
  "currencyCode":"USD","interestCalculationDaysInYearType":365,"locale":"en_GB",
  "digitsAfterDecimal":4,"inMultiplesOf":100,
  "interestCalculationType":1,"interestCompoundingPeriodType":4,"interestPostingPeriodType":4,
  "accountingRule":1,"lockinPeriodFrequency":1,"lockinPeriodFrequencyType":2,
  "preClosurePenalApplicable":true,"preClosurePenalInterest":2,"preClosurePenalInterestOnTypeId":1,
  "minDepositTerm":6,"minDepositTermTypeId":2,"maxDepositTerm":10,"maxDepositTermTypeId":3,
  "inMultiplesOfDepositTerm":2,"inMultiplesOfDepositTermTypeId":2,"withHoldTax":"false","depositAmount":100000,
  "charts":[{
    "fromDate":"01 January 2024","dateFormat":"dd MMMM yyyy","locale":"en_GB","isPrimaryGroupingByAmount":false,
    "chartSlabs":[
      {"description":"s1","periodType":2,"fromPeriod":1,"toPeriod":12,"annualInterestRate":5,"locale":"en_GB"},
      {"description":"s2","periodType":2,"fromPeriod":13,"annualInterestRate":6,"locale":"en_GB"}
    ]
  }]
}')
PROD_ID=$(echo "$PROD" | json_num resourceId)
echo "    productId=$PROD_ID"

if [ -z "$CLIENT_ID" ] || [ -z "$PROD_ID" ]; then
  echo "ERROR: failed to create prerequisites."
  echo "  client response: $CLIENT"
  echo "  product response: $PROD"
  exit 1
fi

FAILS=0
for i in $(seq 1 "$COUNT"); do
  echo "==> Submitting fixed-deposit application ($i/$COUNT) — expecting HTTP 500"
  STATUS=$(curl "${A[@]}" -o /tmp/fd-submit-body.json -w "%{http_code}" -X POST "$B/fixeddepositaccounts" -d "{
    \"clientId\":$CLIENT_ID,\"productId\":$PROD_ID,
    \"interestCalculationDaysInYearType\":365,\"locale\":\"en_GB\",\"dateFormat\":\"dd MMMM yyyy\",\"monthDayFormat\":\"dd MMM\",
    \"interestCalculationType\":1,\"interestCompoundingPeriodType\":4,\"interestPostingPeriodType\":4,
    \"lockinPeriodFrequency\":1,\"lockinPeriodFrequencyType\":2,
    \"preClosurePenalApplicable\":true,\"preClosurePenalInterest\":2,\"preClosurePenalInterestOnTypeId\":1,
    \"minDepositTerm\":6,\"minDepositTermTypeId\":2,\"maxDepositTerm\":10,\"maxDepositTermTypeId\":3,
    \"inMultiplesOfDepositTerm\":2,\"inMultiplesOfDepositTermTypeId\":2,
    \"depositAmount\":100000,\"depositPeriod\":14,\"depositPeriodFrequencyId\":2,
    \"submittedOnDate\":\"01 March 2024\"
  }")
  echo "    HTTP $STATUS -> $(cat /tmp/fd-submit-body.json)"
  [ "$STATUS" = "500" ] && FAILS=$((FAILS+1))
done

echo "==> Done. $FAILS/$COUNT submissions returned HTTP 500 (seeded defect)."
[ "$FAILS" -gt 0 ] && exit 0 || exit 2
