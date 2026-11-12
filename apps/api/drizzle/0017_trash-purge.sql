ALTER TABLE "exercise_entries" ADD COLUMN "purged_at" bigint;--> statement-breakpoint
ALTER TABLE "exercise_templates" ADD COLUMN "purged_at" bigint;--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "purged_at" bigint;--> statement-breakpoint
ALTER TABLE "weight_entries" ADD COLUMN "purged_at" bigint;