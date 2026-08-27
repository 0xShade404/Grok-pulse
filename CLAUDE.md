# GrokPulse

Production Specification for a Real-Time Polymarket 5-Minute Trading Terminal

Purpose: This document is the authoritative product, architecture, engineering, and implementation specification for GrokPulse.

Primary goal: Build a production-grade web trading terminal for short-duration Polymarket prediction markets, with Grok providing market analysis/signals and a deterministic quantitative/risk/execution layer controlling actual trades.

Important: Grok must never have unrestricted authority to place live trades. The AI generates analysis/signals. The deterministic risk engine decides whether an order is permitted.

⸻

## 1. Product Overview

### Product Name

GrokPulse

### Product Description

GrokPulse is a real-time trading terminal for short-duration Polymarket prediction markets, initially focused on 5-minute BTC and ETH markets.

The application combines:

1. Polymarket CLOB market data
2. Real-time order books
3. Independent crypto market data
4. Quantitative feature engineering
5. Probability estimation
6. Grok AI analysis
7. Deterministic risk controls
8. Paper trading
9. Live trading
10. Historical backtesting
11. Performance analytics

The application must be designed as a professional trading terminal, not as a chatbot with a trading button.

⸻

## 2. Core Principle

AI is the analyst, not the execution authority

The architecture must always follow:

```
Market Data
    ↓
Feature Engine
    ↓
Quantitative Model
    ↓
Grok Analysis
    ↓
Structured Signal
    ↓
Risk Engine
    ↓
Order Manager
    ↓
Polymarket CLOB
```

Never:

```
User
 ↓
Grok
 ↓
Direct unrestricted trade
```

Grok can recommend:

```
BUY_YES
BUY_NO
PASS
```

But the risk engine must independently validate:

* market status
* time remaining
* account balance
* current exposure
* maximum trade size
* maximum position
* minimum edge
* minimum liquidity
* maximum slippage
* daily loss limit
* strategy status
* market-data freshness
* Polymarket connectivity
* underlying price-feed health

⸻

## 3. Initial Supported Markets

Initial markets:

* BTC 5-minute markets
* ETH 5-minute markets

Future support:

* SOL
* other liquid crypto markets
* other short-duration prediction markets

Do not build the first release around every Polymarket category.

Optimize the architecture for high-frequency short-duration crypto markets first.

⸻

## 4. User Experience

### Main Dashboard

Route:

```
/
```

Show:

* active 5-minute markets
* current BTC/ETH market
* market probability
* time remaining
* latest Grok signal
* portfolio balance
* today's P&L
* paper/live mode
* recent trades

⸻

## 5. Trading Terminal

Route:

```
/terminal
```

The terminal should contain:

```
┌─────────────────────────────────────────────────────────────┐
│ GROKPULSE       BTC 5M       ETH 5M       Portfolio         │
├───────────────────┬─────────────────────┬───────────────────┤
│ ACTIVE MARKETS    │       PRICE          │ GROK AGENT        │
│                   │                     │                   │
│ BTC > STRIKE      │       0.63 YES       │ Signal: YES       │
│ 02:41 remaining   │                     │ Confidence: 78%  │
│                   │      LIVE CHART      │ Fair: 0.71       │
│ ETH > STRIKE      │                     │ Market: 0.63      │
│ 04:12 remaining   │                     │ Edge: +8%         │
│                   │                     │                   │
├───────────────────┼─────────────────────┼───────────────────┤
│ ORDER BOOK        │ SIGNAL EXPLANATION  │ ORDER PANEL       │
│                   │                     │                   │
│ YES ASK           │ Momentum             │ YES / NO          │
│ YES BID           │ Volatility           │ Price             │
│                   │ Order flow            │ Size              │
│ NO ASK            │ Underlying price     │                   │
│ NO BID            │ Time remaining       │ [PAPER TRADE]     │
│                   │                     │ [LIVE TRADE]      │
└───────────────────┴─────────────────────┴───────────────────┘
```

⸻

## 6. Terminal Requirements

### Market Header

Display:

* market question
* asset
* strike
* market start
* market expiry
* time remaining
* market status
* YES price
* NO price
* spread
* liquidity

### Countdown

The countdown must be based on server time.

Do not trust browser time for trading decisions.

Recommended behavior:

```
T > 60 seconds
    normal trading
T <= 60 seconds
    increased risk restrictions
T <= 20 seconds
    disable new entries by default
T <= 5 seconds
    cancel resting orders
T = 0
    stop trading
    await resolution
```

These rules must be enforced server-side.

⸻

## 7. Order Book

Display:

```
YES
Price       Size
0.67        $120
0.66        $340
0.65        $520
----------------
0.64        $180
0.63        $420
0.62        $250
```

Display:

* best bid
* best ask
* midpoint
* spread
* spread percentage
* depth
* estimated slippage
* recent trades

Do not poll Polymarket from every browser.

Use one backend market-data layer and fan data out through WebSockets.

⸻

## 8. Technology Stack

### Frontend

* Next.js
* React
* TypeScript
* App Router
* Tailwind CSS
* shadcn/ui
* TanStack Query
* Zustand
* Lightweight Charts

### Backend

* TypeScript
* Fastify
* WebSockets

### Database

* PostgreSQL
* TimescaleDB

### Cache / Events

* Redis
* Redis Streams

### Background Jobs

* BullMQ

### AI

* xAI Grok API
* function/tool calling
* structured outputs

### Polymarket

* Polymarket CLOB V2
* official TypeScript client
* WebSocket market data

### Blockchain

* viem

### Authentication

* Clerk or Auth.js

### Deployment

Frontend:

* Vercel

Backend:

* AWS ECS/Fargate

Database:

* AWS RDS PostgreSQL/Timescale-compatible setup

Cache:

* AWS ElastiCache Redis

Storage:

* S3

### Observability

* Sentry
* OpenTelemetry
* Prometheus
* Grafana

### CI/CD

* GitHub Actions

### Infrastructure

* Terraform

### Monorepo

* pnpm
* Turborepo

⸻

## 9. Repository Structure

```
grokpulse/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── terminal/
│   │   ├── charts/
│   │   ├── hooks/
│   │   └── lib/
│   │
│   └── api/
│       ├── routes/
│       ├── middleware/
│       ├── websocket/
│       ├── auth/
│       └── lib/
│
├── services/
│   ├── market-scanner/
│   ├── market-stream/
│   ├── feature-engine/
│   ├── signal-engine/
│   ├── grok-agent/
│   ├── trading-engine/
│   ├── settlement/
│   └── backtester/
│
├── packages/
│   ├── polymarket/
│   ├── xai/
│   ├── database/
│   ├── redis/
│   ├── types/
│   ├── risk/
│   ├── strategy/
│   ├── config/
│   └── logging/
│
├── infra/
│   ├── terraform/
│   ├── docker/
│   └── monitoring/
│
├── scripts/
│
├── tests/
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── CLAUDE.md
```

⸻

## 10. Market Discovery

Create a market scanner service.

Responsibilities:

1. Discover active Polymarket markets.
2. Identify supported 5-minute BTC/ETH markets.
3. Extract token IDs.
4. Extract market expiration.
5. Extract strike information.
6. Detect market lifecycle changes.
7. Subscribe/unsubscribe from relevant WebSocket channels.

Internal representation:

```ts
type Market = {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  asset: "BTC" | "ETH";
  yesTokenId: string;
  noTokenId: string;
  strike?: number;
  startTime: string;
  endTime: string;
  tickSize?: string;
  negRisk?: boolean;
  active: boolean;
  closed: boolean;
  resolved: boolean;
};
```

⸻

## 11. Market Data Pipeline

Architecture:

```
Polymarket
    │
    ├── REST
    │
    └── WebSocket
          │
          ▼
   Market Stream Service
          │
          ▼
     Normalization
          │
     ┌────┴─────┐
     ▼          ▼
   Redis     TimescaleDB
     │
     ▼
 WebSocket API
     │
     ▼
 Browser
```

The backend must maintain authoritative market state.

The browser only consumes the backend's normalized data.

⸻

## 12. Underlying Crypto Data

Use an independent market-data feed for BTC/ETH.

Preferred initial sources:

* Coinbase Advanced Trade WebSocket
* Binance WebSocket
* Kraken
* professional market-data provider

Production should support at least two feeds.

Track:

```
price
bid
ask
spread
volume
timestamp
source
```

Detect stale feeds.

Example:

```
if underlying_feed_age > 2 seconds:
    disable_new_trades()
```

⸻

## 13. Feature Engine

Calculate real-time features.

Required features:

```
price_return_1s
price_return_5s
price_return_15s
price_return_30s
price_return_60s
distance_from_strike
realized_volatility
volume_delta
orderbook_imbalance
spread
market_probability
probability_change_5s
probability_change_15s
time_to_expiry
```

Additional future features:

* VWAP distance
* momentum acceleration
* microprice
* trade imbalance
* volatility regime
* cross-exchange divergence
* order-book pressure
* liquidity changes

⸻

## 14. Quantitative Model

Do not make Grok the only prediction mechanism.

Use:

```
Market Data
     ↓
Feature Engineering
     ↓
Quantitative Probability Model
     ↓
Grok Contextual Analysis
     ↓
Ensemble Probability
```

Possible initial model:

* logistic regression
* gradient boosting
* calibrated tree model

The model should output:

```ts
type QuantPrediction = {
  probabilityYes: number;
  probabilityNo: number;
  confidence: number;
};
```

All probability outputs must be calibrated against historical outcomes.

⸻

## 15. Grok Agent

Grok's role is contextual reasoning.

Grok should receive structured market information rather than an uncontrolled stream of raw data.

Available tools:

```
get_market()
get_orderbook()
get_recent_trades()
get_underlying_price()
get_underlying_candles()
get_market_history()
get_current_position()
get_risk_limits()
calculate_fair_probability()
```

Do not expose a raw unrestricted database query tool.

⸻

## 16. Grok System Prompt

Use the following conceptual system prompt:

```
You are the GrokPulse market-analysis agent.
Your role is to analyze short-duration prediction markets.
You are an analysis component, not an autonomous execution authority.
You do not have permission to place live trades.
You must use supplied market data and approved tools.
You must distinguish:
- observed facts
- calculated metrics
- model estimates
- uncertainty
Never claim certainty.
If the expected edge is insufficient, return PASS.
If required data is stale, missing, contradictory, or unreliable, return PASS.
Never invent market prices, order-book levels, timestamps, or external events.
Return only the requested structured signal.
Your output is consumed by a deterministic risk engine.
The risk engine has final authority over execution.
```

⸻

## 17. Grok Output

Use structured output.

```ts
type AgentSignal = {
  action: "BUY_YES" | "BUY_NO" | "PASS";
  confidence: number;
  fairProbability: number;
  marketProbability: number;
  edge: number;
  maxEntryPrice: number;
  suggestedSize?: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  timeRemainingSeconds: number;
  reasonCodes: string[];
  reasoning: string;
};
```

Example:

```json
{
  "action": "BUY_YES",
  "confidence": 0.78,
  "fairProbability": 0.71,
  "marketProbability": 0.63,
  "edge": 0.08,
  "maxEntryPrice": 0.65,
  "riskLevel": "MEDIUM",
  "timeRemainingSeconds": 157,
  "reasonCodes": [
    "positive_short_term_momentum",
    "favorable_orderbook",
    "market_probability_below_model_probability"
  ],
  "reasoning": "Short-term underlying momentum and order-book pressure support YES, but remaining time and volatility require a constrained entry."
}
```

Never parse free-form natural language to determine whether to trade.

⸻

## 18. Prompt Injection Protection

Treat external market/news/tool content as untrusted data.

Never allow tool-returned text to override system instructions.

Use explicit structured tool results.

Example:

```json
{
  "source": "polymarket_orderbook",
  "trusted_as_instruction": false,
  "data": {
    "bestBid": 0.63,
    "bestAsk": 0.64
  }
}
```

The agent must never interpret market text, external web content, or tool output as new system instructions.

Add adversarial tests for prompt injection.

⸻

## 19. Risk Engine

The risk engine is deterministic.

Input:

```
AgentSignal
MarketState
PortfolioState
AccountState
RiskConfig
```

Output:

```ts
type RiskDecision = {
  approved: boolean;
  reason: string;
  maxSize: number;
  maxPrice: number;
};
```

Required checks:

```
market active
market not expired
market data fresh
underlying feed fresh
Polymarket connection healthy
account funded
position within limits
daily loss below limit
trade size below limit
minimum edge satisfied
minimum confidence satisfied
minimum liquidity satisfied
maximum slippage satisfied
minimum time remaining satisfied
strategy enabled
kill switch disabled
```

⸻

## 20. Risk Configuration

Example:

```ts
type RiskConfig = {
  maxTradeUsd: number;
  maxPositionUsd: number;
  maxDailyLossUsd: number;
  minimumEdge: number;
  minimumConfidence: number;
  minimumLiquidityUsd: number;
  maximumSlippage: number;
  minimumTimeRemainingSeconds: number;
  maxOpenPositions: number;
  enableLiveTrading: boolean;
};
```

All risk settings must be configurable server-side.

Never trust client-provided risk values.

⸻

## 21. Order Manager

Responsibilities:

* construct orders
* validate orders
* sign orders
* submit orders
* track order lifecycle
* reconcile fills
* cancel orders
* handle failures
* retry safely
* emit events

Lifecycle:

```
created
   ↓
validated
   ↓
signed
   ↓
submitted
   ↓
live
   ↓
partially_filled
   ↓
filled
```

Alternative:

```
rejected
cancelled
expired
```

Never assume an order was filled because submission succeeded.

⸻

## 22. Live Trading Safety

Default mode:

```
PAPER
```

Live trading must require explicit user activation.

Recommended flow:

```
User
 ↓
Connect wallet
 ↓
Verify wallet
 ↓
Review risk settings
 ↓
Enable live trading
 ↓
Explicit confirmation
 ↓
Live trading
```

Provide:

```
EMERGENCY KILL SWITCH
```

The kill switch must:

1. disable new orders
2. optionally cancel resting orders
3. mark strategy as halted
4. emit an audit event

⸻

## 23. Wallet Security

Never store raw private keys in PostgreSQL.

Never expose private keys to the browser unless using a deliberately designed self-custody signing architecture.

Production options:

* user-controlled wallet signing
* MPC wallet
* HSM-backed signer
* secure managed wallet infrastructure

If a server-side signer is implemented:

```
Trading Engine
      ↓
Signer Service
      ↓
HSM/MPC
      ↓
Signed Order
```

The trading engine must not have direct access to raw private keys.

⸻

## 24. Database Schema

Create these primary tables.

### users

```
id
email
created_at
updated_at
```

### wallets

```
id
user_id
address
provider
created_at
```

### markets

```
id
condition_id
slug
question
asset
yes_token_id
no_token_id
strike
start_time
end_time
tick_size
active
closed
resolved
created_at
updated_at
```

### market_ticks

```
id
market_id
timestamp
yes_bid
yes_ask
no_bid
no_ask
yes_mid
no_mid
volume
```

### orderbook_snapshots

```
id
market_id
timestamp
side
price
size
```

### trades

```
id
market_id
timestamp
side
price
size
```

### signals

```
id
market_id
strategy_version
agent_run_id
action
confidence
fair_probability
market_probability
edge
max_entry_price
risk_level
created_at
```

### orders

```
id
user_id
market_id
client_order_id
exchange_order_id
side
price
size
status
submitted_at
updated_at
```

### fills

```
id
order_id
price
size
fee
timestamp
```

### positions

```
id
user_id
market_id
side
size
average_price
realized_pnl
unrealized_pnl
```

### portfolio_snapshots

```
id
user_id
timestamp
balance
equity
pnl
```

### agent_runs

```
id
market_id
model
input_hash
output_json
latency_ms
created_at
```

### agent_tool_calls

```
id
agent_run_id
tool_name
input_json
output_json
latency_ms
created_at
```

### risk_events

```
id
user_id
market_id
event_type
reason
metadata
created_at
```

### strategy_versions

```
id
name
version
config_json
active
created_at
```

⸻

## 25. Redis Architecture

Use Redis for:

```
live market state
order books
latest underlying prices
WebSocket fanout
distributed locks
rate limiting
job queues
short-lived agent state
```

Suggested streams:

```
market.events
underlying.events
signal.events
order.events
fill.events
risk.events
```

Use distributed locks to prevent duplicate order execution.

⸻

## 26. Background Workers

Create:

```
market-scanner
market-stream
underlying-stream
feature-calculator
signal-generator
grok-agent
order-manager
position-reconciler
settlement-worker
backtest-worker
analytics-worker
```

Each worker must have:

* health status
* structured logs
* retry policy
* dead-letter handling
* metrics

⸻

## 27. API

Implement:

```
GET /api/markets
GET /api/markets/:id
GET /api/markets/:id/orderbook
GET /api/markets/:id/history
GET /api/signals/latest
POST /api/agent/analyse
GET /api/portfolio
GET /api/positions
GET /api/orders
GET /api/fills
POST /api/paper/orders
POST /api/live/orders
DELETE /api/orders/:id
GET /api/performance
GET /api/agent/runs
```

⸻

## 28. WebSocket API

Implement:

```
/ws/markets
/ws/portfolio
/ws/orders
/ws/signals
```

Messages should be typed.

Example:

```ts
type MarketUpdate = {
  type: "MARKET_UPDATE";
  marketId: string;
  timestamp: string;
  data: {
    yesBid: number;
    yesAsk: number;
    noBid: number;
    noAsk: number;
    timeRemainingSeconds: number;
  };
};
```

⸻

## 29. Frontend State

Use Zustand for local terminal state.

Suggested stores:

```
marketStore
orderbookStore
signalStore
portfolioStore
orderStore
terminalStore
settingsStore
```

TanStack Query should manage REST/server-state caching.

WebSocket events should update live state.

⸻

## 30. Charts

Use Lightweight Charts.

Display:

Prediction market

* YES probability
* NO probability
* midpoint
* bid/ask

Underlying

* BTC/ETH price
* strike
* distance to strike
* short-term momentum

Synchronize timestamps.

⸻

## 31. Paper Trading

Paper mode must simulate realistic execution.

Do not simply fill orders at midpoint.

Simulate:

* bid/ask
* spread
* slippage
* latency
* partial fills
* fees
* order expiry
* resolution

Paper trading should consume the same order-management interfaces as live trading.

Only the execution adapter changes:

```
ExecutionAdapter
   ├── PaperExecutionAdapter
   └── PolymarketExecutionAdapter
```

⸻

## 32. Backtesting

Create:

```
services/backtester
```

Input:

```
historical markets
historical order books
historical underlying prices
strategy version
risk configuration
```

Output:

```
total trades
win rate
profit
loss
expected value
profit factor
max drawdown
Sharpe
average edge
average slippage
latency impact
calibration
```

⸻

## 33. Backtest Replay

Backtests should replay historical data chronologically.

Do not use future information.

At each historical timestamp:

```
market state
    ↓
features available at that moment
    ↓
model prediction
    ↓
Grok analysis
    ↓
risk engine
    ↓
simulated order
```

The system must prevent look-ahead bias.

⸻

## 34. Probability Calibration

This is a critical feature.

If the system produces:

```
0.70 probability
```

then historical outcomes for comparable signals should approach approximately:

```
70% YES
```

Track calibration buckets:

```
0.50–0.55
0.55–0.60
0.60–0.65
0.65–0.70
0.70–0.75
0.75–0.80
0.80+
```

Display:

* predicted probability
* observed frequency
* calibration error

⸻

## 35. Performance Dashboard

Route:

```
/performance
```

Show:

```
Total P&L
Today's P&L
7D P&L
30D P&L
Win Rate
Profit Factor
Average Edge
Average Return
Max Drawdown
Trades
Wins
Losses
Average Hold Time
Average Slippage
Agent Latency
Execution Latency
```

Charts:

* cumulative P&L
* drawdown
* win rate
* edge distribution
* predicted vs actual probability
* P&L by market
* P&L by strategy version

⸻

## 36. Agent Dashboard

Route:

```
/agent
```

Show:

```
Current model
Signal count
BUY YES
BUY NO
PASS
Average confidence
Average edge
Agent latency
Correct signals
Incorrect signals
Calibration
```

Allow inspection of each run:

```
market state
features
tool calls
agent output
risk decision
execution result
outcome
```

This creates an audit trail.

⸻

## 37. Observability

Track:

```
market_data_latency
underlying_feed_latency
websocket_latency
feature_calculation_latency
grok_latency
risk_engine_latency
order_submission_latency
fill_latency
database_latency
redis_latency
```

Track errors:

```
market_stream_disconnect
stale_market_data
stale_underlying_data
order_submission_failure
order_rejection
fill_reconciliation_failure
agent_failure
database_failure
redis_failure
```

⸻

## 38. Kill Conditions

Trading must automatically halt if:

```
market data becomes stale
underlying data becomes stale
Polymarket connection becomes unhealthy
database state is inconsistent
position reconciliation fails
risk engine unavailable
signer unavailable
unexpected order state occurs
daily loss limit is reached
system clock becomes unreliable
```

Example:

```ts
if (
  marketDataStale ||
  underlyingDataStale ||
  exchangeUnavailable ||
  riskEngineUnavailable
) {
  tradingState = "HALTED";
}
```

⸻

## 39. Security

Never put secrets in frontend code.

Required secrets:

```
XAI_API_KEY
POLYMARKET_API_KEY
POLYMARKET_API_SECRET
POLYMARKET_API_PASSPHRASE
DATABASE_URL
REDIS_URL
AUTH_SECRET
```

Use environment variables/secrets management.

Never commit .env.

Provide:

```
.env.example
```

with placeholders only.

⸻

## 40. Authentication

All authenticated endpoints must verify the user.

Trading endpoints require:

```
authenticated user
+
verified wallet
+
live trading enabled
+
risk checks passed
```

Never trust:

```
userId
wallet address
risk limits
account balance
```

provided by the browser.

Resolve authoritative values server-side.

⸻

## 41. Audit Logging

Every live trading action must produce an immutable audit event.

Examples:

```
SIGNAL_GENERATED
RISK_APPROVED
RISK_REJECTED
ORDER_CREATED
ORDER_SIGNED
ORDER_SUBMITTED
ORDER_FILLED
ORDER_CANCELLED
POSITION_OPENED
POSITION_CLOSED
KILL_SWITCH_ENABLED
KILL_SWITCH_DISABLED
LIVE_TRADING_ENABLED
LIVE_TRADING_DISABLED
```

Include:

```
user
timestamp
market
strategy version
signal ID
risk decision
order ID
metadata
```

⸻

## 42. Rate Limiting

The backend must centralize Polymarket API usage.

Never allow:

```
100 browsers
×
direct Polymarket polling
```

Instead:

```
Polymarket
    ↓
Market Data Service
    ↓
Redis
    ↓
100 browsers
```

Respect exchange API limits.

Use:

* connection reuse
* batching where appropriate
* caching
* WebSockets
* exponential backoff

⸻

## 43. Error Handling

Every external service call must handle:

* timeout
* retryable error
* authentication error
* rate limit
* malformed response
* connection failure
* stale data

Never blindly retry order submission.

Order submission requires idempotency.

⸻

## 44. Idempotency

Every order must have:

```
clientOrderId
```

The system must prevent duplicate orders caused by:

* network retries
* worker restarts
* WebSocket reconnects
* API timeouts

Before retrying an order submission:

```
check whether order already exists
```

⸻

## 45. Clock Synchronization

Short-duration markets make clock correctness critical.

Server infrastructure should use synchronized time.

Never use:

```
browser Date.now()
```

as the authoritative trading clock.

Maintain:

```
serverNow
exchangeTimestamp
underlyingTimestamp
marketEndTime
```

Monitor clock drift.

⸻

## 46. Trading Strategy State Machine

Each market should have:

```
DISCOVERED
 ↓
ACTIVE
 ↓
ANALYZING
 ↓
TRADE_ELIGIBLE
 ↓
ORDER_PENDING
 ↓
POSITION_OPEN
 ↓
EXPIRING
 ↓
EXPIRED
 ↓
RESOLVED
```

Possible error state:

```
HALTED
```

⸻

## 47. Trading Rules

Initial conservative rules:

```
No trade if data is stale.
No trade if time remaining is too short.
No trade if edge < minimum edge.
No trade if confidence < minimum confidence.
No trade if liquidity is insufficient.
No trade if expected slippage exceeds threshold.
No trade if daily loss limit reached.
No trade if position limit reached.
No trade if market state is ambiguous.
No trade if underlying feeds disagree materially.
No trade if risk engine is unavailable.
```

Default fallback:

```
PASS
```

⸻

## 48. Frontend Components

Create:

```
MarketSelector
MarketHeader
Countdown
ProbabilityDisplay
PriceChart
UnderlyingChart
OrderBook
RecentTrades
GrokSignalCard
SignalReasoning
RiskStatus
OrderTicket
PositionPanel
PortfolioSummary
TradeHistory
PerformanceChart
AgentRunViewer
KillSwitch
ConnectionStatus
```

⸻

## 49. UI Design

Design language:

* professional trading terminal
* dark-first
* dense information layout
* clear typography
* minimal decoration
* responsive
* high information density
* accessible contrast
* obvious risk states

Important states:

```
LIVE
PAPER
HALTED
STALE DATA
HIGH RISK
ORDER PENDING
FILLED
REJECTED
```

Do not use color as the only indicator.

⸻

## 50. Mobile

Mobile should support:

* market monitoring
* signal viewing
* portfolio
* position monitoring
* order cancellation
* kill switch

Do not prioritize complex trading execution on mobile for V1.

Desktop is the primary trading experience.

⸻

## 51. API Security

Use:

* HTTPS
* secure cookies
* CSRF protection where applicable
* rate limiting
* schema validation
* authentication middleware
* authorization middleware
* input sanitization
* audit logging

Use Zod for shared schemas.

⸻

## 52. Type Safety

Use TypeScript throughout.

Shared package:

```
packages/types
```

Contains:

```
Market
OrderBook
Trade
Signal
RiskDecision
Order
Fill
Position
Portfolio
AgentRun
```

The frontend and backend must use the same schemas.

⸻

## 53. Validation

Use Zod.

Example:

```ts
const AgentSignalSchema = z.object({
  action: z.enum(["BUY_YES", "BUY_NO", "PASS"]),
  confidence: z.number().min(0).max(1),
  fairProbability: z.number().min(0).max(1),
  marketProbability: z.number().min(0).max(1),
  edge: z.number(),
  maxEntryPrice: z.number().min(0).max(1),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  timeRemainingSeconds: z.number().nonnegative(),
  reasonCodes: z.array(z.string()),
  reasoning: z.string()
});
```

Reject invalid AI output.

Never execute from malformed output.

⸻

## 54. Testing

Required test categories:

### Unit tests

* probability calculations
* edge calculations
* risk rules
* order sizing
* countdown
* state machine
* P&L
* calibration

### Integration tests

* Polymarket adapter
* Redis
* PostgreSQL
* Grok tool calls
* execution adapter

### End-to-end

```
market discovered
 ↓
market data arrives
 ↓
features calculated
 ↓
signal generated
 ↓
risk decision
 ↓
paper order
 ↓
fill
 ↓
position
 ↓
resolution
 ↓
P&L
```

⸻

## 55. Adversarial Testing

Test:

```
stale data
missing price
invalid AI JSON
wrong token ID
expired market
duplicate order
network timeout
partial fill
WebSocket reconnect
database outage
Redis outage
Grok timeout
Grok hallucinated price
malicious tool output
prompt injection
clock drift
duplicate worker
```

The system must fail closed.

⸻

## 56. Failure Philosophy

For trading infrastructure:

```
uncertain = do not trade
```

Prefer:

```
missed opportunity
```

over:

```
uncontrolled trade
```

⸻

## 57. Environment Variables

Create:

```
# Application
NODE_ENV=
APP_URL=
# Database
DATABASE_URL=
# Redis
REDIS_URL=
# Authentication
AUTH_SECRET=
# xAI
XAI_API_KEY=
# Polymarket
POLYMARKET_API_KEY=
POLYMARKET_API_SECRET=
POLYMARKET_API_PASSPHRASE=
# Wallet
WALLET_PROVIDER=
WALLET_ADDRESS=
# Observability
SENTRY_DSN=
# Feature flags
ENABLE_LIVE_TRADING=false
ENABLE_PAPER_TRADING=true
```

Never commit real values.

⸻

## 58. Docker

Create Dockerfiles for:

```
web
api
market-scanner
market-stream
feature-engine
signal-engine
grok-agent
trading-engine
settlement
backtester
```

Create local development:

```
docker-compose.yml
```

with:

```
postgres
redis
```

⸻

## 59. Local Development

Required commands:

```
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Services should be independently runnable.

⸻

## 60. CI/CD

GitHub Actions pipeline:

```
Pull Request
    ↓
Install
    ↓
Lint
    ↓
Typecheck
    ↓
Unit Tests
    ↓
Integration Tests
    ↓
Build
    ↓
Security Checks
```

Deployment:

```
main
 ↓
build
 ↓
test
 ↓
deploy staging
 ↓
smoke tests
 ↓
production
```

Live trading must not automatically enable merely because production deployed.

⸻

## 61. Staging

Create a staging environment where:

```
ENABLE_LIVE_TRADING=false
```

All execution is paper trading.

Production must require explicit live-trading configuration.

⸻

## 62. Feature Flags

Implement:

```
ENABLE_LIVE_TRADING
ENABLE_GROK
ENABLE_BACKTESTING
ENABLE_BTC
ENABLE_ETH
ENABLE_AUTO_EXECUTION
ENABLE_MOBILE_TRADING
```

Default:

```
ENABLE_LIVE_TRADING=false
ENABLE_AUTO_EXECUTION=false
```

⸻

## 63. Strategy Versioning

Every signal must reference a strategy version.

Example:

```yaml
strategy:
    name: grokpulse-btc-5m
    version: 0.1.0
```

When changing:

* features
* prompts
* model
* thresholds
* risk configuration

create a new strategy version.

Never silently change a production strategy.

⸻

## 64. Agent Versioning

Store:

```
model
model_version
system_prompt_hash
tool_schema_hash
strategy_version
```

with every agent run.

This allows historical reproduction.

⸻

## 65. Grok Tool Design

Tool definitions should be narrow.

Example:

```ts
{
  name: "get_orderbook",
  description: "Return the current normalized order book for the selected market.",
  input_schema: {
    type: "object",
    properties: {
      marketId: {
        type: "string"
      }
    },
    required: ["marketId"]
  }
}
```

Do not expose:

```
execute_trade()
```

to the Grok analysis agent.

Instead expose:

```
get_market
get_orderbook
get_recent_trades
get_underlying_price
get_underlying_candles
get_market_history
get_current_position
get_risk_limits
calculate_fair_probability
```

⸻

## 66. Grok Analysis Sequence

For each eligible market:

1. Load market state.
2. Validate data freshness.
3. Calculate deterministic features.
4. Generate quantitative probability.
5. Give Grok structured context.
6. Grok analyzes:
   - momentum
   - market probability
   - order flow
   - volatility
   - time remaining
   - quantitative estimate
7. Grok returns structured signal.
8. Validate signal schema.
9. Risk engine evaluates signal.
10. If rejected:
       PASS
11. If approved:
       create order request
12. Order manager executes.
13. Fill listener updates position.
14. Settlement worker resolves outcome.
15. Analytics records performance.

⸻

## 67. Signal Example

Input:

```json
{
  "market": {
    "asset": "BTC",
    "yesProbability": 0.63,
    "timeRemainingSeconds": 157,
    "strike": 118250
  },
  "underlying": {
    "price": 118310,
    "return5s": 0.0008,
    "return30s": 0.0021,
    "return60s": 0.0037
  },
  "orderbook": {
    "yesBid": 0.62,
    "yesAsk": 0.64,
    "imbalance": 0.18
  },
  "quantModel": {
    "fairProbability": 0.69
  }
}
```

Grok output:

```json
{
  "action": "BUY_YES",
  "confidence": 0.74,
  "fairProbability": 0.70,
  "marketProbability": 0.63,
  "edge": 0.07,
  "maxEntryPrice": 0.65,
  "riskLevel": "MEDIUM",
  "timeRemainingSeconds": 157,
  "reasonCodes": [
    "positive_momentum",
    "positive_orderflow",
    "model_market_divergence"
  ]
}
```

Risk engine then independently decides whether this is executable.

⸻

## 68. Order Sizing

Never let Grok determine unrestricted position size.

Instead:

```
base size
×
confidence adjustment
×
edge adjustment
×
liquidity adjustment
×
risk constraints
```

Then cap:

```
maxTradeUsd
maxPositionUsd
maxDailyRisk
```

All sizing must happen deterministically.

⸻

## 69. Slippage

Before submitting an order:

```
simulate order against current order book
```

Calculate:

```
expected average fill
worst-case fill
slippage
depth consumed
```

Reject if:

```
slippage > maximum allowed
```

⸻

## 70. Resolution

Create a settlement worker.

Responsibilities:

* detect market resolution
* verify outcome
* update positions
* calculate realized P&L
* update portfolio
* record settlement event

Never mark a position resolved solely because the countdown reached zero.

Countdown expiry and market resolution are separate states.

⸻

## 71. Data Retention

Retain:

### High-frequency data

For example:

```
1-second/tick data
```

for a configurable retention period.

### Aggregated data

Retain longer:

```
1m
5m
15m
1h
1d
```

Historical data should be sufficient for backtesting.

⸻

## 72. Performance Requirements

Target:

```
Market data → backend
< 250 ms typical
Backend → browser
< 100 ms typical
Feature calculation
< 50 ms
Risk decision
< 10 ms
Order construction
< 25 ms
AI analysis
target < 1–2 seconds
```

Do not make live trading depend on slow AI inference if deterministic emergency controls are needed.

The AI layer can be asynchronous.

⸻

## 73. AI Latency Architecture

For fast markets, consider:

```
continuous quantitative model
        ↓
potential opportunity detected
        ↓
Grok analysis triggered
        ↓
signal cached
        ↓
risk engine
```

Do not call Grok every second.

Use a trigger such as:

```
significant price change
OR
probability divergence
OR
new market
OR
orderbook regime change
OR
periodic refresh
```

⸻

## 74. AI Cost Control

Cache:

* market context
* static instructions
* tool definitions

Avoid sending unnecessary historical data.

Use compact structured features.

Do not send entire order books when only top N levels are necessary.

⸻

## 75. Explainability

The UI should display:

```
Market Probability
Quant Probability
Grok Fair Probability
Edge
Confidence
```

Example:

```
Market       63%
Quant        68%
Grok         70%
Estimated Edge
+7%
Confidence
74%
```

Never display:

```
Guaranteed
Certain
Risk-free
```

⸻

## 76. Legal / Risk UI

Include clear language:

```
Trading prediction markets involves financial risk.
AI-generated signals are estimates, not guarantees.
Past performance does not guarantee future results.
```

Do not advertise the system as guaranteed profitable.

Check applicable legal/regulatory requirements before enabling users to trade real funds.

⸻

## 77. Admin Dashboard

Route:

```
/admin
```

Display:

```
system health
market-stream health
Grok health
Redis health
database health
Polymarket health
active markets
active positions
open orders
risk events
errors
```

Admin controls:

```
global kill switch
disable strategy
disable asset
disable live trading
```

All admin actions must be audited.

⸻

## 78. Health Endpoints

Implement:

```
GET /health
GET /health/ready
GET /health/live
```

Readiness should verify critical dependencies.

Example:

```
database
redis
market stream
risk engine
```

Do not expose sensitive information.

⸻

## 79. Metrics

Prometheus metrics:

```
grokpulse_market_updates_total
grokpulse_market_data_latency_ms
grokpulse_grok_requests_total
grokpulse_grok_latency_ms
grokpulse_signals_total
grokpulse_risk_rejections_total
grokpulse_orders_total
grokpulse_fills_total
grokpulse_order_latency_ms
grokpulse_pnl
grokpulse_active_positions
grokpulse_stale_data_events_total
```

⸻

## 80. Logging

Use structured JSON logs.

Every log should include when applicable:

```
timestamp
service
environment
requestId
userId
marketId
strategyVersion
signalId
orderId
severity
message
metadata
```

Never log:

```
private keys
API secrets
authentication tokens
full credentials
```

⸻

## 81. Development Phases

### Phase 1 — Read Only

Build:

* Next.js
* terminal UI
* market scanner
* Polymarket WebSocket
* order book
* countdown
* BTC/ETH feed
* charts

No trading.

⸻

### Phase 2 — Grok

Build:

* feature engine
* quantitative baseline
* Grok agent
* structured signals
* agent history
* explanation panel

No live trading.

⸻

### Phase 3 — Paper Trading

Build:

* paper execution adapter
* positions
* portfolio
* P&L
* simulated fills
* performance dashboard

⸻

### Phase 4 — Backtesting

Build:

* historical data ingestion
* replay engine
* strategy versioning
* calibration
* performance reports

⸻

### Phase 5 — Live Trading

Build:

* wallet integration
* CLOB V2 adapter
* secure signing
* live order manager
* risk engine
* kill switch
* reconciliation

⸻

### Phase 6 — Production Hardening

Build:

* monitoring
* alerting
* HA Redis
* backups
* disaster recovery
* audit logs
* load tests
* security tests
* failure tests

⸻

## 82. MVP Definition of Done

MVP is complete when:

```
[ ] User can authenticate
[ ] User can view active BTC 5M markets
[ ] User can view active ETH 5M markets
[ ] Market data updates in real time
[ ] Order book updates in real time
[ ] Countdown is server-authoritative
[ ] Underlying crypto price is visible
[ ] Quantitative features calculate correctly
[ ] Grok can analyze a market
[ ] Grok returns validated structured output
[ ] Signal history is stored
[ ] Risk engine evaluates signals
[ ] Paper orders can be created
[ ] Paper fills are simulated
[ ] Positions are tracked
[ ] P&L is calculated
[ ] Historical signals can be reviewed
[ ] Backtesting works
[ ] Calibration is measured
[ ] System health is visible
[ ] Kill switch works
[ ] All tests pass
```

⸻

## 83. Live Trading Definition of Done

Do not enable live trading until:

```
[ ] Paper trading has been validated
[ ] Backtests are reproducible
[ ] No look-ahead bias exists
[ ] Risk limits are enforced server-side
[ ] Duplicate orders are impossible
[ ] Order reconciliation works
[ ] Wallet signing is secure
[ ] Kill switch works
[ ] Stale-data halting works
[ ] Underlying-feed failure halting works
[ ] Polymarket outage handling works
[ ] Database backups work
[ ] Audit logging works
[ ] Monitoring alerts work
[ ] Security review completed
[ ] Legal/regulatory review completed
```

⸻

## 84. Claude Code Implementation Instructions

When implementing this project:

1. Inspect the repository before changing anything.
2. Preserve existing working functionality.
3. Do not invent APIs.
4. Use official Polymarket documentation for CLOB integration.
5. Use official xAI documentation for Grok integration.
6. Use current package versions compatible with the project.
7. Prefer TypeScript.
8. Use shared types and Zod schemas.
9. Keep services modular.
10. Do not place trading logic in React components.
11. Do not place secrets in frontend code.
12. Do not implement live trading before paper trading works.
13. Do not give Grok direct unrestricted order execution.
14. Fail closed when market data is stale or ambiguous.
15. Add tests for every risk rule.
16. Add tests for duplicate order prevention.
17. Add tests for WebSocket reconnection.
18. Add tests for AI malformed output.
19. Add tests for prompt injection.
20. Add structured logging.
21. Add health endpoints.
22. Add metrics.
23. Document every non-obvious trading decision.

⸻

## 85. Claude Coding Workflow

For each implementation task:

1. Inspect relevant files.
2. Identify dependencies.
3. Define types/interfaces.
4. Implement smallest production-safe version.
5. Add tests.
6. Run typecheck.
7. Run lint.
8. Run tests.
9. Fix failures.
10. Review security implications.
11. Review failure modes.
12. Summarize changes.

Do not make huge speculative rewrites.

⸻

## 86. Coding Standards

Use:

* strict TypeScript
* ESLint
* Prettier
* Zod
* dependency injection where useful
* explicit error types
* typed API responses
* typed WebSocket messages
* no any unless justified
* no silent error swallowing

Prefer small composable functions.

⸻

## 87. Architecture Rule

Business logic must not depend directly on infrastructure.

For example:

```
strategy
risk
portfolio
P&L
```

should not directly import:

```
Redis
Postgres
Fastify
React
```

Use interfaces.

Example:

```ts
interface ExecutionAdapter {
  submitOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
}
```

Implement:

```
PaperExecutionAdapter
PolymarketExecutionAdapter
```

⸻

## 88. Dependency Injection

Services should receive dependencies.

Example:

```ts
class RiskEngine {
  constructor(
    private readonly portfolio: PortfolioRepository,
    private readonly marketState: MarketStateRepository,
    private readonly config: RiskConfig
  ) {}
}
```

This makes testing easier.

⸻

## 89. No Hard-Coded Production Secrets

Never write:

```ts
const API_KEY = "..."
```

Never commit:

```
.env
```

Only commit:

```
.env.example
```

⸻

## 90. No Fake Production Data

During development, mock data must be clearly marked.

Do not silently fall back from live market data to fabricated prices.

Use:

```
DATA_SOURCE=mock
```

or:

```
DATA_SOURCE=live
```

explicitly.

⸻

## 91. Paper/Live Isolation

Use separate execution paths:

```
PAPER
    ↓
PaperExecutionAdapter
LIVE
    ↓
PolymarketExecutionAdapter
```

Never determine mode from a frontend-only variable.

Server configuration is authoritative.

⸻

## 92. Recommended First Build Order

Claude Code should implement in this order:

1. Monorepo
2. Shared TypeScript types
3. PostgreSQL schema
4. Redis layer
5. Market scanner
6. Polymarket market adapter
7. Polymarket WebSocket adapter
8. Underlying price adapter
9. Market state service
10. Feature engine
11. Quant model interface
12. Grok client
13. Grok tools
14. Signal engine
15. Risk engine
16. Paper execution
17. Position service
18. Portfolio service
19. WebSocket API
20. Next.js terminal
21. Backtester
22. Performance dashboard
23. Observability
24. Security hardening
25. Live execution adapter

⸻

## 93. Definition of the Core Architecture

The final system must resemble:

```
                         ┌─────────────────────┐
                         │     Next.js UI      │
                         │   Trading Terminal  │
                         └──────────┬──────────┘
                                    │
                              WebSocket/API
                                    │
                         ┌──────────▼──────────┐
                         │     API Gateway     │
                         └──────────┬──────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
          Market Service       Signal Service    Portfolio Service
                 │                  │                  │
                 │                  ▼                  │
                 │             Grok Agent              │
                 │                  │                  │
                 │             Signal Only              │
                 │                  ▼                  │
                 │             Risk Engine              │
                 │                  │                  │
                 │                  ▼                  │
                 │            Order Manager              │
                 │                  │                  │
                 ▼                  ▼                  ▼
             Redis              CLOB V2             PostgreSQL
                 ▲                  │                  ▲
                 │                  │                  │
                 └──────────── Market Data ────────────┘
                                    ▲
                                    │
                         ┌──────────┴──────────┐
                         │    Crypto Feeds    │
                         │   BTC / ETH Spot   │
                         └─────────────────────┘
```

⸻

## 94. Most Important Production Rule

The system must always prioritize:

```
Capital preservation
        >
Data integrity
        >
Risk controls
        >
Execution correctness
        >
AI signal quality
        >
Trading frequency
```

Never optimize trading frequency at the expense of execution safety.

⸻

## 95. Final Product Vision

GrokPulse should ultimately feel like:

```
Bloomberg-style terminal
+
Polymarket CLOB
+
real-time crypto market data
+
quantitative probability engine
+
Grok research/analysis agent
+
professional risk engine
+
backtesting platform
```

The AI should make the terminal more intelligent.

It should not make the trading system less deterministic.

⸻

## 96. Claude Code Final Instruction

Build GrokPulse as a production-quality application from this specification.

Do not implement a toy demo.

Do not use fake data in production paths.

Do not expose secrets.

Do not allow the AI to bypass the risk engine.

Do not enable live trading by default.

Do not assume an order was filled.

Do not trade on stale data.

Do not use browser time for authoritative trading decisions.

Do not silently recover from critical data inconsistencies.

When uncertain:

```
HALT
```

When the market state is ambiguous:

```
PASS
```

When the risk engine rejects a signal:

```
DO NOT EXECUTE
```

The final system should be modular, testable, observable, auditable, secure, and capable of moving from read-only → paper trading → controlled live trading without rewriting the architecture.

⸻

## Reference Documentation

Use official/current documentation when implementing integrations:

* Polymarket developer documentation
* Polymarket CLOB documentation
* xAI API documentation
* Next.js documentation
* Redis documentation
* PostgreSQL documentation
* TimescaleDB documentation

For Claude-specific implementation, use structured outputs/tool schemas rather than relying on free-form text parsing, and systematically evaluate prompts and agent behavior before production deployment. Anthropic specifically recommends empirical evaluation and layered guardrails for agentic applications. (Claude Platform Docs)

End of CLAUDE.md
