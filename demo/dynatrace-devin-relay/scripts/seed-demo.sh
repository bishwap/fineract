#!/usr/bin/env bash
#
# seed-demo.sh — create a demo client + fixed-deposit product on a fresh
# Fineract instance and print their IDs (so the banking console can pin to
# them). Safe to run once after a clean deploy.
#
# Prints two shell-parseable lines:
#   FD_CLIENT_ID=<n>
#   FD_PRODUCT_ID=<n>
#
# Env (optional): BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS, CLIENT_COUNT

set -uo pipefail

BASE_URL="${BASE_URL:-https://localhost:8443}"
TENANT="${TENANT:-default}"
ADMIN_USER="${ADMIN_USER:-mifos}"
ADMIN_PASS="${ADMIN_PASS:-password}"
CLIENT_COUNT="${CLIENT_COUNT:-8}"

B="$BASE_URL/fineract-provider/api/v1"
A=(-sk -u "$ADMIN_USER:$ADMIN_PASS" -H "Fineract-Platform-TenantId: $TENANT" -H "Content-Type: application/json")
json_num() { grep -o "\"$1\":[0-9]*" | grep -o '[0-9]*' | head -1; }

curl "${A[@]}" -X PUT "$B/currencies" -d '{"currencies":["USD"]}' >/dev/null

# A handful of clients so the directory looks populated (names are overlaid
# with realistic values by the console UI).
LAST_CLIENT=""
for i in $(seq 1 "$CLIENT_COUNT"); do
  C=$(curl "${A[@]}" -X POST "$B/clients" -d '{
    "officeId":1,"legalFormId":1,"firstname":"Demo","lastname":"Client",
    "active":true,"activationDate":"01 January 2024","dateFormat":"dd MMMM yyyy","locale":"en"
  }')
  LAST_CLIENT=$(echo "$C" | json_num clientId)
  [ -z "$LAST_CLIENT" ] && LAST_CLIENT=$(echo "$C" | json_num resourceId)
done

SHORT="D$(date +%s | tail -c 4)$RANDOM"; SHORT="${SHORT:0:4}"
PROD=$(curl "${A[@]}" -X POST "$B/fixeddepositproducts" -d '{
  "name":"Demo FD Product '"$RANDOM"'","shortName":"'"$SHORT"'","description":"demo fd",
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

if [ -z "$LAST_CLIENT" ] || [ -z "$PROD_ID" ]; then
  echo "ERROR: seeding failed" >&2
  echo "  client: $C" >&2
  echo "  product: $PROD" >&2
  exit 1
fi

echo "FD_CLIENT_ID=$LAST_CLIENT"
echo "FD_PRODUCT_ID=$PROD_ID"
