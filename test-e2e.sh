#!/bin/bash

BASE_URL="http://localhost:3000"
TIMESTAMP=$(date +%s%N | cut -b1-13)
USER_EMAIL="test_${TIMESTAMP}@test.com"
USER_PASSWORD="Test123!@#"
ACCESS_TOKEN=""
CHAR_ID=""
USER_ID=""

echo "=== NanoMMO End-to-End Test ==="
echo ""

# Step 1: Register user
echo "Step 1: Register user..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$USER_EMAIL\",
    \"username\": \"test_${TIMESTAMP}\",
    \"password\": \"$USER_PASSWORD\"
  }")

echo "Response: $REGISTER_RESPONSE"
USER_ID=$(echo "$REGISTER_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "User ID: $USER_ID"
echo ""

# Step 2: Login
echo "Step 2: Login..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$USER_EMAIL\",
    \"password\": \"$USER_PASSWORD\"
  }")

echo "Response: $LOGIN_RESPONSE"
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)
echo "Access Token: ${ACCESS_TOKEN:0:30}..."
echo ""

# Step 3: Create character with gambit page
echo "Step 3: Create character with gambit page..."
CHAR_RESPONSE=$(curl -s -X POST "$BASE_URL/characters" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"name\": \"TestChar_${TIMESTAMP}\",
    \"mapId\": \"map_green_grounds\"
  }")

echo "Response: $CHAR_RESPONSE"
CHAR_ID=$(echo "$CHAR_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Character ID: $CHAR_ID"
echo ""

# Step 4: Create gambit page
echo "Step 4: Create gambit page..."
GAMBIT_RESPONSE=$(curl -s -X POST "$BASE_URL/gambit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"characterId\": \"$CHAR_ID\",
    \"name\": \"Test Gambit\",
    \"lines\": [
      {
        \"condition\": \"self_hp_band:CRITICAL\",
        \"action\": \"use_item:pot_hp_medium\"
      },
      {
        \"condition\": \"always\",
        \"action\": \"attack\"
      }
    ]
  }")

echo "Response: $GAMBIT_RESPONSE"
GAMBIT_ID=$(echo "$GAMBIT_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Gambit ID: $GAMBIT_ID"
echo ""

# Step 5: Equip weapon
echo "Step 5: Equip weapon..."
EQUIP_RESPONSE=$(curl -s -X POST "$BASE_URL/equipment/equip" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"characterId\": \"$CHAR_ID\",
    \"itemId\": \"equip_sword_t1\"
  }")

echo "Response: $EQUIP_RESPONSE"
echo ""

# Step 6: Get equipment stats
echo "Step 6: Get equipment stats..."
STATS_RESPONSE=$(curl -s -X GET "$BASE_URL/equipment/stats/total?characterId=$CHAR_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "Stats Response: $STATS_RESPONSE"
echo ""

# Step 7: Enter map
echo "Step 7: Enter map..."
MAP_RESPONSE=$(curl -s -X POST "$BASE_URL/map/enter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"characterId\": \"$CHAR_ID\",
    \"mapId\": \"map_green_grounds\"
  }")

echo "Response: $MAP_RESPONSE"
echo ""

# Step 8: Queue battles
echo "Step 8: Queue battles (trigger battle queue)..."
BATTLE_QUEUE_RESPONSE=$(curl -s -X POST "$BASE_URL/battle/queue-battles" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"characterId\": \"$CHAR_ID\"
  }")

echo "Response: $BATTLE_QUEUE_RESPONSE"
echo ""

echo "=== Test Complete ==="
echo "User Email: $USER_EMAIL"
echo "User ID: $USER_ID"
echo "Character ID: $CHAR_ID"
echo "Access Token: ${ACCESS_TOKEN:0:30}..."
