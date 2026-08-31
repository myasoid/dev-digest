CREATE TABLE "eval_suite_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"skill_versions" jsonb NOT NULL,
	"case_set_revision" text NOT NULL,
	"scope" text DEFAULT 'suite' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cases_total" integer DEFAULT 0 NOT NULL,
	"cases_passed" integer DEFAULT 0 NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"findings_kept" integer DEFAULT 0 NOT NULL,
	"findings_dropped" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"cost_usd" double precision,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "unlisted" text DEFAULT 'ignore' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_pr_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "suite_run_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "findings_kept" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "findings_dropped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "case_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "violations" jsonb;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_suite_runs_ws_idx" ON "eval_suite_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_owner_idx" ON "eval_suite_runs" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_source_pr_id_pull_requests_id_fk" FOREIGN KEY ("source_pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_run_id_eval_suite_runs_id_fk" FOREIGN KEY ("suite_run_id") REFERENCES "public"."eval_suite_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_source_pr_idx" ON "eval_cases" USING btree ("source_pr_id");