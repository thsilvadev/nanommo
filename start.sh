#!/bin/bash

# NanoMMO Quick Start Script
# Sets up the development environment and starts the project

set -e

echo "🎮 NanoMMO - Browser Idle MMORPG"
echo "=================================="
echo ""

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed."
    echo "   Install from: https://docs.docker.com/get-docker/"
    exit 1
fi

# Setup
echo "📚 Installing dependencies..."
pnpm install

echo ""
echo "🔧 Setting up environment..."
if [ ! -f .env.local ]; then
    cp .env.example .env.local
    echo "   ✓ Created .env.local (edit with your settings)"
else
    echo "   ✓ .env.local already exists"
fi

echo ""
echo "🐳 Starting Docker services..."
docker-compose up -d

# Wait for postgres
echo "⏳ Waiting for database to be ready..."
sleep 10

echo ""
echo "🚀 Starting backend server..."
cd apps/api
pnpm dev &
BACKEND_PID=$!

echo ""
echo "=================================="
echo "✅ NanoMMO is running!"
echo ""
echo "API Server: http://localhost:3000"
echo "Reverse Proxy: http://localhost"
echo ""
echo "📝 Useful commands:"
echo "   - pnpm -r test           # Run tests"
echo "   - pnpm -r lint           # Lint code"
echo "   - docker-compose logs    # View logs"
echo "   - pnpm db:migrate        # Run migrations"
echo ""
echo "📚 Documentation:"
echo "   - README.md              # Setup & overview"
echo "   - NEXT_STEPS.md          # Implementation guide"
echo "   - SPEC.md                # Game design spec"
echo ""
echo "Press Ctrl+C to stop"
echo "=================================="
echo ""

wait $BACKEND_PID
