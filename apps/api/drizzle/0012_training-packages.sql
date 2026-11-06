ALTER TABLE "exercise_entries" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "exercise_templates" ADD COLUMN "extra_items" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_templates" ADD COLUMN "pinned" boolean;