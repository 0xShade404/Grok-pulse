CREATE TYPE "public"."agent_action" AS ENUM('BUY_YES', 'BUY_NO', 'PASS');--> statement-breakpoint
CREATE TYPE "public"."asset" AS ENUM('BTC', 'ETH', 'SOL');--> statement-breakpoint
CREATE TYPE "public"."market_side" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('created', 'validated', 'signed', 'submitted', 'live', 'partially_filled', 'filled', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."risk_event_type" AS ENUM('SIGNAL_GENERATED', 'RISK_APPROVED', 'RISK_REJECTED', 'ORDER_CREATED', 'ORDER_SIGNED', 'ORDER_SUBMITTED', 'ORDER_FILLED', 'ORDER_CANCELLED', 'POSITION_OPENED', 'POSITION_CLOSED', 'KILL_SWITCH_ENABLED', 'KILL_SWITCH_DISABLED', 'LIVE_TRADING_ENABLED', 'LIVE_TRADING_DISABLED');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition_id" text NOT NULL,
	"slug" text NOT NULL,
	"question" text NOT NULL,
	"asset" "asset" NOT NULL,
	"yes_token_id" text NOT NULL,
	"no_token_id" text NOT NULL,
	"strike" numeric,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"tick_size" text,
	"neg_risk" boolean,
	"active" boolean DEFAULT true NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_condition_id_unique" UNIQUE("condition_id"),
	CONSTRAINT "markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "market_ticks" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"yes_bid" numeric NOT NULL,
	"yes_ask" numeric NOT NULL,
	"no_bid" numeric NOT NULL,
	"no_ask" numeric NOT NULL,
	"yes_mid" numeric NOT NULL,
	"no_mid" numeric NOT NULL,
	"volume" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "market_ticks_id_timestamp_pk" PRIMARY KEY("id","timestamp")
);
--> statement-breakpoint
CREATE TABLE "orderbook_snapshots" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"side" "market_side" NOT NULL,
	"price" numeric NOT NULL,
	"size" numeric NOT NULL,
	CONSTRAINT "orderbook_snapshots_id_timestamp_pk" PRIMARY KEY("id","timestamp")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"side" "market_side" NOT NULL,
	"price" numeric NOT NULL,
	"size" numeric NOT NULL,
	CONSTRAINT "trades_id_timestamp_pk" PRIMARY KEY("id","timestamp")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"system_prompt_hash" text,
	"tool_schema_hash" text,
	"strategy_version" text,
	"input_hash" text NOT NULL,
	"output_json" jsonb,
	"output_raw" jsonb,
	"latency_ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"strategy_version" text NOT NULL,
	"agent_run_id" uuid,
	"action" "agent_action" NOT NULL,
	"confidence" numeric NOT NULL,
	"fair_probability" numeric NOT NULL,
	"market_probability" numeric NOT NULL,
	"edge" numeric NOT NULL,
	"max_entry_price" numeric NOT NULL,
	"risk_level" "risk_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"price" numeric NOT NULL,
	"size" numeric NOT NULL,
	"fee" numeric DEFAULT '0' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"client_order_id" text NOT NULL,
	"exchange_order_id" text,
	"side" "market_side" NOT NULL,
	"price" numeric NOT NULL,
	"size" numeric NOT NULL,
	"status" "order_status" DEFAULT 'created' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"balance" numeric NOT NULL,
	"equity" numeric NOT NULL,
	"pnl" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"side" "market_side" NOT NULL,
	"size" numeric DEFAULT '0' NOT NULL,
	"average_price" numeric DEFAULT '0' NOT NULL,
	"realized_pnl" numeric DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"market_id" uuid,
	"event_type" "risk_event_type" NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_ticks" ADD CONSTRAINT "market_ticks_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orderbook_snapshots" ADD CONSTRAINT "orderbook_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallets_user_id_idx" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallets_address_idx" ON "wallets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "markets_asset_idx" ON "markets" USING btree ("asset");--> statement-breakpoint
CREATE INDEX "markets_active_closed_idx" ON "markets" USING btree ("active","closed");--> statement-breakpoint
CREATE INDEX "markets_end_time_idx" ON "markets" USING btree ("end_time");--> statement-breakpoint
CREATE INDEX "market_ticks_market_id_timestamp_idx" ON "market_ticks" USING btree ("market_id","timestamp");--> statement-breakpoint
CREATE INDEX "orderbook_snapshots_market_id_timestamp_idx" ON "orderbook_snapshots" USING btree ("market_id","timestamp");--> statement-breakpoint
CREATE INDEX "trades_market_id_timestamp_idx" ON "trades" USING btree ("market_id","timestamp");--> statement-breakpoint
CREATE INDEX "agent_runs_market_id_created_at_idx" ON "agent_runs" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_agent_run_id_idx" ON "agent_tool_calls" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "signals_market_id_created_at_idx" ON "signals" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_agent_run_id_idx" ON "signals" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "fills_order_id_idx" ON "fills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fills_timestamp_idx" ON "fills" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_client_order_id_idx" ON "orders" USING btree ("client_order_id");--> statement-breakpoint
CREATE INDEX "orders_user_id_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_market_id_idx" ON "orders" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_user_id_timestamp_idx" ON "portfolio_snapshots" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_user_market_side_idx" ON "positions" USING btree ("user_id","market_id","side");--> statement-breakpoint
CREATE INDEX "positions_market_id_idx" ON "positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "risk_events_user_id_idx" ON "risk_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "risk_events_market_id_idx" ON "risk_events" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "risk_events_event_type_idx" ON "risk_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "risk_events_created_at_idx" ON "risk_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_name_version_idx" ON "strategy_versions" USING btree ("name","version");