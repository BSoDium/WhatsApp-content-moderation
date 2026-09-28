CREATE TABLE `call_strikes` (
	`contact_id` text PRIMARY KEY NOT NULL,
	`unanswered_count` integer DEFAULT 0 NOT NULL,
	`strike_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `monitored_contacts` ADD `call_nuisance_threshold` integer;