#!/bin/bash
echo ""
echo "========================================="
echo "  FINDING ADMIN CLAIM CODE..."
echo "========================================="
docker compose -f docker-compose.local.yml logs api 2>&1 | grep -i "claim\|admin code\|setup\|invite" | tail -20
echo ""
echo "Copy the code above and go to http://localhost:3124"
echo "Register an account, then use the claim code to become admin."
echo "========================================="
