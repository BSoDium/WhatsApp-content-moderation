CREATE TABLE `corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_log_id` integer NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`strike_reverted` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corrections_audit_log_idx` ON `corrections` (`audit_log_id`);--> statement-breakpoint
CREATE INDEX `corrections_contact_idx` ON `corrections` (`contact_id`,`created_at`);